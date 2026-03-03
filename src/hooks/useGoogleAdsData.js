import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { sbFetchAll, sbFetchAllParallel, buildQuery } from '../lib/supabaseRest';

function computeDateRange(preset, customFrom, customTo) {
  const today = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10);
  const daysAgo = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };
  switch (preset) {
    case 'today': return { from: fmt(today), to: fmt(today) };
    case 'yesterday': return { from: fmt(daysAgo(1)), to: fmt(daysAgo(1)) };
    case 'last7': return { from: fmt(daysAgo(6)), to: fmt(today) };
    case 'last14': return { from: fmt(daysAgo(13)), to: fmt(today) };
    case 'last30': return { from: fmt(daysAgo(29)), to: fmt(today) };
    case 'this_month': { const f = new Date(today.getFullYear(), today.getMonth(), 1); return { from: fmt(f), to: fmt(today) }; }
    case 'last_month': { const f = new Date(today.getFullYear(), today.getMonth() - 1, 1); const l = new Date(today.getFullYear(), today.getMonth(), 0); return { from: fmt(f), to: fmt(l) }; }
    case 'custom': return { from: customFrom || null, to: customTo || null };
    default: return { from: null, to: null };
  }
}

function computePreviousPeriod(fromStr, toStr) {
  if (!fromStr || !toStr) return { from: null, to: null };
  const from = new Date(fromStr + 'T00:00:00');
  const to = new Date(toStr + 'T00:00:00');
  const days = Math.round((to - from) / 86400000) + 1;
  const prevTo = new Date(from);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - days + 1);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { from: fmt(prevFrom), to: fmt(prevTo) };
}

function num(v) { return Number(v) || 0; }

function addMetrics(o) {
  o.ctr = o.impressions ? (o.clicks / o.impressions) * 100 : 0;
  o.cpc = o.clicks ? o.cost / o.clicks : 0;
  o.conv_rate = o.clicks ? (o.conversions / o.clicks) * 100 : 0;
  o.cpa = o.conversions ? o.cost / o.conversions : 0;
  return o;
}

export function useGoogleAdsData() {
  const [filters, setFilters] = useState({
    datePreset: 'all', dateFrom: '', dateTo: '',
    compareOn: false, compareFrom: '', compareTo: '',
    customerId: 'ALL', channelType: 'all', status: 'all',
    campaignSearch: '', adGroupSearch: '', keywordSearch: '',
  });

  const [rawCampaigns, setRawCampaigns] = useState([]);
  const [rawAdGroups, setRawAdGroups] = useState([]);
  const [rawKeywords, setRawKeywords] = useState([]);
  const [rawSearchTerms, setRawSearchTerms] = useState([]);
  const [rawGeo, setRawGeo] = useState([]);
  const [rawConversions, setRawConversions] = useState([]);
  const [rawCompareCampaigns, setRawCompareCampaigns] = useState([]);
  const [campaignStatusMap, setCampaignStatusMap] = useState(new Map());
  const [customers, setCustomers] = useState([]);
  const [channelTypes, setChannelTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const optionsLoaded = useRef(false);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const updateFilter = useCallback((key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const batchUpdateFilters = useCallback((updates) => {
    setFilters((prev) => ({ ...prev, ...updates }));
  }, []);

  const fetchData = useCallback(async () => {
    const f = filtersRef.current;
    setLoading(true);
    setError(null);
    try {
      const { from, to } = computeDateRange(f.datePreset, f.dateFrom, f.dateTo);
      const cid = f.customerId;

      if (!optionsLoaded.current) {
        const custData = await sbFetchAll(
          'gads_customers?select=customer_id,descriptive_name&status=eq.ENABLED&order=descriptive_name'
        );
        console.log('[GAds] gads_customers:', custData.length, 'rows');
        if (custData.length) {
          setCustomers(custData.map((c) => ({ id: c.customer_id, name: c.descriptive_name || c.customer_id })));
        }
      }

      const campaignExtra = '&order=date.desc'
        + (f.campaignSearch ? '&campaign_name=ilike.*' + encodeURIComponent(f.campaignSearch) + '*' : '');
      const adGroupExtra = '&order=date.desc'
        + (f.adGroupSearch ? '&ad_group_name=ilike.*' + encodeURIComponent(f.adGroupSearch) + '*' : '');
      const keywordExtra = '&order=date.desc'
        + (f.keywordSearch ? '&keyword_text=ilike.*' + encodeURIComponent(f.keywordSearch) + '*' : '');

      let compFrom = null, compTo = null;
      if (f.compareOn) {
        if (f.compareFrom && f.compareTo) {
          compFrom = f.compareFrom; compTo = f.compareTo;
        } else {
          const prev = computePreviousPeriod(from, to);
          compFrom = prev.from; compTo = prev.to;
        }
      }

      const safe = (promise) => promise.catch((err) => {
        console.warn('[GAds] Table fetch failed, skipping:', err.message);
        return [];
      });

      const [campaignData, statusData] = await Promise.all([
        safe(sbFetchAllParallel(buildQuery('gads_campaign_daily', { customerId: cid, dateFrom: from, dateTo: to, extra: campaignExtra }))),
        safe(sbFetchAllParallel(buildQuery('gads_campaign_status', { customerId: cid }))),
      ]);

      const [adGroupData, keywordData, searchTermData] = await Promise.all([
        safe(sbFetchAllParallel(buildQuery('gads_adgroup_daily', { customerId: cid, dateFrom: from, dateTo: to, extra: adGroupExtra }))),
        safe(sbFetchAllParallel(buildQuery('gads_keyword_daily', { customerId: cid, dateFrom: from, dateTo: to, extra: keywordExtra }))),
        safe(sbFetchAllParallel(buildQuery('gads_search_term_daily', { customerId: cid, dateFrom: from, dateTo: to, extra: '&order=date.desc' }))),
      ]);

      const [geoData, conversionData] = await Promise.all([
        safe(sbFetchAllParallel(buildQuery('gads_geo_location_daily', { customerId: cid, dateFrom: from, dateTo: to, extra: '&order=date.desc' }))),
        safe(sbFetchAllParallel(buildQuery('gads_conversion_daily', { customerId: cid, dateFrom: from, dateTo: to, extra: '&order=date.desc' }))),
      ]);

      let compareCampaignData = [];
      if (f.compareOn && compFrom && compTo) {
        compareCampaignData = await safe(sbFetchAllParallel(buildQuery('gads_campaign_daily', { customerId: cid, dateFrom: compFrom, dateTo: compTo, extra: campaignExtra })));
      }

      console.log('[GAds] Fetch results:', {
        campaigns: campaignData.length,
        adGroups: adGroupData.length,
        keywords: keywordData.length,
        searchTerms: searchTermData.length,
        geo: geoData.length,
        conversions: conversionData.length,
        statuses: statusData.length,
        dateRange: { from, to },
      });
      if (campaignData.length > 0) console.log('[GAds] Sample campaign row:', campaignData[0]);

      if (campaignData.length === 0 && statusData.length === 0) {
        console.warn('[GAds] All tables returned 0 rows. Check RLS policies or ensure tables have data.');
      }

      const statusMap = new Map();
      statusData.forEach((s) => statusMap.set(String(s.campaign_id), s));
      setCampaignStatusMap(statusMap);

      let validCampaignIds = null;
      if (f.channelType !== 'all' || f.status !== 'all') {
        const filtered = statusData.filter((s) => {
          if (f.channelType !== 'all' && s.campaign_type !== f.channelType) return false;
          if (f.status !== 'all' && s.campaign_status !== f.status) return false;
          return true;
        });
        validCampaignIds = new Set(filtered.map((s) => String(s.campaign_id)));
      }

      const filterByCampaign = (rows) =>
        validCampaignIds ? rows.filter((r) => validCampaignIds.has(String(r.campaign_id))) : rows;

      setRawCampaigns(filterByCampaign(campaignData));
      setRawAdGroups(filterByCampaign(adGroupData));
      setRawKeywords(filterByCampaign(keywordData));
      setRawSearchTerms(filterByCampaign(searchTermData));
      setRawGeo(filterByCampaign(geoData));
      setRawConversions(filterByCampaign(conversionData));
      setRawCompareCampaigns(f.compareOn ? filterByCampaign(compareCampaignData) : []);

      if (!optionsLoaded.current) {
        const types = new Set();
        statusData.forEach((s) => { if (s.campaign_type) types.add(s.campaign_type); });
        if (types.size === 0) campaignData.forEach((r) => { if (r.campaign_type) types.add(r.campaign_type); });
        setChannelTypes([...types].sort());
        optionsLoaded.current = true;
      }
    } catch (err) {
      console.error('[GAds] Fetch error:', err);
      const msg = err.message || 'Failed to fetch data';
      setError(
        msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network')
          ? 'Cannot reach Supabase. Check your network connection or try a VPN/mobile hotspot.'
          : msg
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  /* ── KPIs ── */
  const kpis = useMemo(() => {
    if (!rawCampaigns.length) return null;
    const k = { cost: 0, clicks: 0, impressions: 0, conversions: 0, conversions_value: 0, allConversions: 0 };
    rawCampaigns.forEach((r) => {
      k.cost += num(r.cost);
      k.clicks += num(r.clicks);
      k.impressions += num(r.impressions);
      k.conversions += num(r.conversions);
      k.conversions_value += num(r.conversions_value);
      k.allConversions += num(r.all_conversions);
    });
    k.ctr = k.impressions ? (k.clicks / k.impressions) * 100 : 0;
    k.cpc = k.clicks ? k.cost / k.clicks : 0;
    k.conv_rate = k.clicks ? (k.conversions / k.clicks) * 100 : 0;
    k.cpa = k.conversions ? k.cost / k.conversions : 0;
    k.roas = k.cost ? k.conversions_value / k.cost : 0;
    k.campaigns = new Set(rawCampaigns.map((r) => r.campaign_id)).size;
    return k;
  }, [rawCampaigns]);

  /* ── Campaign Types ── */
  const campaignTypesAgg = useMemo(() => {
    const map = new Map();
    let totalCost = 0;
    rawCampaigns.forEach((r) => {
      const type = r.campaign_type || campaignStatusMap.get(String(r.campaign_id))?.campaign_type || 'Unknown';
      if (!map.has(type)) map.set(type, { type, campaign_ids: new Set(), cost: 0, clicks: 0, impressions: 0, conversions: 0, conversions_value: 0 });
      const a = map.get(type);
      a.campaign_ids.add(r.campaign_id);
      const cost = num(r.cost);
      a.cost += cost;
      a.clicks += num(r.clicks);
      a.impressions += num(r.impressions);
      a.conversions += num(r.conversions);
      a.conversions_value += num(r.conversions_value);
      totalCost += cost;
    });
    return [...map.values()].map((o) => {
      o.campaign_count = o.campaign_ids.size;
      delete o.campaign_ids;
      o.spend_pct = totalCost ? (o.cost / totalCost) * 100 : 0;
      return addMetrics(o);
    }).sort((a, b) => b.cost - a.cost);
  }, [rawCampaigns, campaignStatusMap]);

  /* ── Campaigns ── */
  const campaignsAgg = useMemo(() => {
    const map = new Map();
    rawCampaigns.forEach((r) => {
      const id = r.campaign_id;
      if (!map.has(id)) {
        const status = campaignStatusMap.get(String(id));
        map.set(id, {
          campaign_id: id,
          campaign_name: r.campaign_name,
          campaign_status: status?.campaign_status || '',
          channel_type: r.campaign_type || status?.campaign_type || '',
          cost: 0, clicks: 0, impressions: 0, conversions: 0,
          conversions_value: 0, allConversions: 0,
        });
      }
      const a = map.get(id);
      a.cost += num(r.cost);
      a.clicks += num(r.clicks);
      a.impressions += num(r.impressions);
      a.conversions += num(r.conversions);
      a.conversions_value += num(r.conversions_value);
      a.allConversions += num(r.all_conversions);
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [rawCampaigns, campaignStatusMap]);

  /* ── Ad Groups ── */
  const adGroupsAgg = useMemo(() => {
    const map = new Map();
    rawAdGroups.forEach((r) => {
      const id = r.ad_group_id;
      if (!map.has(id)) map.set(id, {
        ad_group_id: id,
        ad_group_name: r.ad_group_name,
        campaign_name: r.campaign_name || '',
        campaign_id: r.campaign_id,
        ad_group_status: '',
        cost: 0, clicks: 0, impressions: 0, conversions: 0, conversions_value: 0,
      });
      const a = map.get(id);
      a.cost += num(r.cost);
      a.clicks += num(r.clicks);
      a.impressions += num(r.impressions);
      a.conversions += num(r.conversions);
      a.conversions_value += num(r.conversions_value);
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [rawAdGroups]);

  /* ── Keywords ── */
  const keywordsAgg = useMemo(() => {
    const map = new Map();
    rawKeywords.forEach((r) => {
      const id = `${r.ad_group_id}_${r.keyword_id}`;
      if (!map.has(id)) map.set(id, {
        _key: id,
        keyword_id: r.keyword_id,
        keyword_text: r.keyword_text,
        keyword_match_type: r.keyword_match_type,
        campaign_id: r.campaign_id,
        ad_group_id: r.ad_group_id,
        campaign_name: r.campaign_name || '',
        ad_group_name: r.ad_group_name || '',
        quality_score: r.quality_score,
        cost: 0, clicks: 0, impressions: 0, conversions: 0, conversions_value: 0,
      });
      const a = map.get(id);
      a.cost += num(r.cost);
      a.clicks += num(r.clicks);
      a.impressions += num(r.impressions);
      a.conversions += num(r.conversions);
      a.conversions_value += num(r.conversions_value);
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [rawKeywords]);

  /* ── Search Terms ── */
  const searchTermsAgg = useMemo(() => {
    const map = new Map();
    rawSearchTerms.forEach((r) => {
      const id = `${r.ad_group_id}_${r.search_term}`;
      if (!map.has(id)) map.set(id, {
        _key: id,
        search_term: r.search_term,
        campaign_id: r.campaign_id,
        campaign_name: r.campaign_name || '',
        ad_group_id: r.ad_group_id,
        cost: 0, clicks: 0, impressions: 0, conversions: 0, conversions_value: 0,
      });
      const a = map.get(id);
      a.cost += num(r.cost);
      a.clicks += num(r.clicks);
      a.impressions += num(r.impressions);
      a.conversions += num(r.conversions);
      a.conversions_value += num(r.conversions_value);
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [rawSearchTerms]);

  /* ── Geo ── */
  const geoAgg = useMemo(() => {
    const map = new Map();
    rawGeo.forEach((r) => {
      const loc = r.most_specific || r.city || r.region || r.country || 'Unknown';
      if (!map.has(loc)) map.set(loc, {
        location: loc,
        country: r.country || '',
        region: r.region || '',
        city: r.city || '',
        cost: 0, clicks: 0, impressions: 0, conversions: 0, conversions_value: 0,
      });
      const a = map.get(loc);
      a.cost += num(r.cost);
      a.clicks += num(r.clicks);
      a.impressions += num(r.impressions);
      a.conversions += num(r.conversions);
      a.conversions_value += num(r.conversions_value);
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [rawGeo]);

  /* ── Conversions ── */
  const conversionsAgg = useMemo(() => {
    const map = new Map();
    rawConversions.forEach((r) => {
      const id = `${r.campaign_id}_${r.conversion_action_id}`;
      if (!map.has(id)) {
        const status = campaignStatusMap.get(String(r.campaign_id));
        map.set(id, {
          _key: id,
          campaign_id: r.campaign_id,
          campaign_name: r.campaign_name || '',
          conversion_action_name: r.conversion_action_name || '',
          conversion_action_category: r.conversion_action_category || '',
          channel_type: status?.campaign_type || '',
          conversions: 0, conversions_value: 0, allConversions: 0, cost: 0,
        });
      }
      const a = map.get(id);
      a.conversions += num(r.conversions);
      a.conversions_value += num(r.conversions_value);
    });

    const campaignCostMap = new Map();
    rawCampaigns.forEach((r) => {
      campaignCostMap.set(r.campaign_id, (campaignCostMap.get(r.campaign_id) || 0) + num(r.cost));
    });

    return [...map.values()].map((o) => {
      o.cost = campaignCostMap.get(o.campaign_id) || 0;
      o.cpa = o.conversions ? o.cost / o.conversions : 0;
      return o;
    }).sort((a, b) => b.conversions - a.conversions);
  }, [rawConversions, rawCampaigns, campaignStatusMap]);

  /* ── Daily Trends ── */
  const dailyTrends = useMemo(() => {
    const map = new Map();
    rawCampaigns.forEach((r) => {
      const d = r.date; if (!d) return;
      if (!map.has(d)) map.set(d, { date: d, cost: 0, clicks: 0, impressions: 0, conversions: 0 });
      const a = map.get(d);
      a.cost += num(r.cost);
      a.clicks += num(r.clicks);
      a.impressions += num(r.impressions);
      a.conversions += num(r.conversions);
    });
    return [...map.values()].map(addMetrics).sort((a, b) => a.date.localeCompare(b.date));
  }, [rawCampaigns]);

  /* ── Compare KPIs ── */
  const compareKpis = useMemo(() => {
    if (!rawCompareCampaigns.length) return null;
    const k = { cost: 0, clicks: 0, impressions: 0, conversions: 0, conversions_value: 0, allConversions: 0 };
    rawCompareCampaigns.forEach((r) => {
      k.cost += num(r.cost);
      k.clicks += num(r.clicks);
      k.impressions += num(r.impressions);
      k.conversions += num(r.conversions);
      k.conversions_value += num(r.conversions_value);
      k.allConversions += num(r.all_conversions);
    });
    k.ctr = k.impressions ? (k.clicks / k.impressions) * 100 : 0;
    k.cpc = k.clicks ? k.cost / k.clicks : 0;
    k.conv_rate = k.clicks ? (k.conversions / k.clicks) * 100 : 0;
    k.cpa = k.conversions ? k.cost / k.conversions : 0;
    k.roas = k.cost ? k.conversions_value / k.cost : 0;
    k.campaigns = new Set(rawCompareCampaigns.map((r) => r.campaign_id)).size;
    return k;
  }, [rawCompareCampaigns]);

  /* ── Compare Daily Trends ── */
  const compareDailyTrends = useMemo(() => {
    if (!rawCompareCampaigns.length) return [];
    const map = new Map();
    rawCompareCampaigns.forEach((r) => {
      const d = r.date; if (!d) return;
      if (!map.has(d)) map.set(d, { date: d, cost: 0, clicks: 0, impressions: 0, conversions: 0 });
      const a = map.get(d);
      a.cost += num(r.cost);
      a.clicks += num(r.clicks);
      a.impressions += num(r.impressions);
      a.conversions += num(r.conversions);
    });
    return [...map.values()].map(addMetrics).sort((a, b) => a.date.localeCompare(b.date));
  }, [rawCompareCampaigns]);

  return {
    filters, updateFilter, batchUpdateFilters, fetchData,
    loading, error, customers, channelTypes,
    kpis, compareKpis,
    campaignTypes: campaignTypesAgg,
    campaigns: campaignsAgg,
    adGroups: adGroupsAgg,
    keywords: keywordsAgg,
    searchTerms: searchTermsAgg,
    geoData: geoAgg,
    conversionsData: conversionsAgg,
    dailyTrends, compareDailyTrends,
    rowCounts: {
      campaigns: rawCampaigns.length,
      adGroups: rawAdGroups.length,
      keywords: rawKeywords.length,
      searchTerms: rawSearchTerms.length,
      geo: rawGeo.length,
      conversions: rawConversions.length,
    },
  };
}
