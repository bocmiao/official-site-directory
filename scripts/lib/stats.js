import { effectiveStatus, hostOf } from '../../src/search.js';

export function catalogStats(sites, today = new Date().toISOString().slice(0, 10)) {
  const countBy = (key) => Object.fromEntries([...new Set(sites.map(key))].sort().map((value) => [value, sites.filter((s) => key(s) === value).length]));
  return { generated_at: today, total: sites.length,
    status: countBy((s) => effectiveStatus(s.verification_status, s.review_due_at, today)),
    categories: countBy((s) => s.category), sources: countBy((s) => s.source?.id || 'curated'),
    subcategories: countBy((s) => s.subcategory || s.category),
    localization: countBy((s) => s.localization?.method || 'not-localized'),
    tags: Object.fromEntries([...new Set(sites.flatMap((s) => s.tags))].sort().map((tag) => [tag, sites.filter((s) => s.tags.includes(tag)).length])),
    profile_coverage: { source_metadata: sites.filter((s) => s.profile).length,
      established: sites.filter((s) => s.profile?.established).length,
      locations: sites.filter((s) => s.profile?.locations?.length).length,
      package_platforms: sites.filter((s) => s.profile?.package_platforms?.length).length },
    regions: countBy((s) => s.region || 'UNSPECIFIED'),
    unique_hosts: new Set(sites.map((s) => hostOf(s.url))).size,
    https: sites.filter((s) => s.url.startsWith('https:')).length,
    http: sites.filter((s) => s.url.startsWith('http:')).length,
    verified_entries: sites.filter((s) => effectiveStatus(s.verification_status, s.review_due_at, today) === 'verified').reduce((sum, s) => sum + s.entries.length, 0),
    imported_with_source: sites.filter((s) => s.source?.url && s.collected_at).length };
}
