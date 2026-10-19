import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { databaseErrorSummary, listInventoryLocations, listStockActivity, listStockActivityActors } from '@/lib/db';
import { requireReadPermission } from '@/lib/auth';

type QueryValue = string | string[] | undefined;
type ActivityPageProps = { searchParams: Promise<{ location?: QueryValue; type?: QueryValue; q?: QueryValue; actor?: QueryValue; from?: QueryValue; to?: QueryValue }> };

function firstValue(value: QueryValue) {
  return Array.isArray(value) ? value[0] : value;
}

const movementTypes = ['receiving', 'sale', 'return', 'adjustment'] as const;

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export default function ActivityPage({ searchParams }: ActivityPageProps) {
  return (
    <Suspense fallback={<main className="page-shell"><section className="loading-panel" aria-busy="true"><p className="eyebrow">Inventory / Activity</p><h1>Movement history</h1><p>Loading stock activity…</p></section></main>}>
      <ActivityContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ActivityContent({ searchParams }: ActivityPageProps) {
  await connection();
  const user = await requireReadPermission('activity:read');

  const params = await searchParams;
  const rawLocation = firstValue(params.location) ?? '';
  const rawType = firstValue(params.type) ?? 'all';
  const rawSearch = firstValue(params.q) ?? '';
  const rawActor = firstValue(params.actor) ?? '';
  const rawFromDate = firstValue(params.from) ?? '';
  const rawToDate = firstValue(params.to) ?? '';
  const search = rawSearch.trim().slice(0, 100);
  const fromDate = validDate(rawFromDate) ? rawFromDate : '';
  const toDate = validDate(rawToDate) ? rawToDate : '';
  const reversedDateRange = Boolean(fromDate && toDate && fromDate > toDate);
  const safeFromDate = reversedDateRange ? '' : fromDate;
  const safeToDate = reversedDateRange ? '' : toDate;
  const movementType = movementTypes.includes(rawType as (typeof movementTypes)[number]) ? rawType : 'all';
  let locations;
  let actors;
  let activity;
  let locationId = '';
  let actorId = '';
  try {
    [locations, actors] = await Promise.all([listInventoryLocations(), user.publicDemo ? Promise.resolve([]) : listStockActivityActors()]);
    locationId = locations.some((location) => location.id === rawLocation) ? rawLocation : '';
    actorId = rawActor === 'legacy' || actors.some((actor) => actor.id === rawActor) ? rawActor : '';
    activity = await listStockActivity({ locationId, movementType, search, actorId, fromDate: safeFromDate, toDate: safeToDate });
    if (user.publicDemo) activity = activity.map((movement) => ({ ...movement, actorName: 'Demo user' }));
  } catch (error) {
    console.error('Activity read failed:', databaseErrorSummary(error));
    return <main className="page-shell"><section className="unavailable-panel"><p className="eyebrow">Inventory / Activity</p><h1>Activity is unavailable</h1><p>The movement history could not be loaded. Check the deployment database configuration and try again.</p><Link className="button button-secondary" href="/">Back to overview</Link></section></main>;
  }
  const hasFilters = Boolean(locationId || search || movementType !== 'all' || actorId || safeFromDate || safeToDate || reversedDateRange);

  return (
    <main className="page-shell">
      <div className="page-heading"><div><p className="eyebrow">Inventory / Activity</p><h1>Movement history</h1><p className="page-description">A time-ordered record of stock changes by product and location.</p></div><Link className="button button-primary" href="/stock">{user.publicDemo ? 'View stock on hand' : 'Record a stock change'} <span aria-hidden="true">→</span></Link></div>
      <aside className="demo-notice" aria-label="Inventory audit history"><span className="notice-mark" aria-hidden="true">i</span><p><strong>Inventory audit history.</strong> {user.publicDemo ? 'Fictional sample activity; actor names are anonymized in this public read-only view.' : 'This ledger tracks unit quantities, not payments, point-of-sale transactions, or accounting entries. New stock changes include the signed-in user&apos;s identity.'}</p></aside>

      <section className="catalog-panel" aria-labelledby="activity-heading">
        <div className="catalog-toolbar activity-toolbar">
          <div><h2 id="activity-heading">Stock movements</h2><p>{activity.length === 200 ? 'Showing the latest 200 matching movements' : `${activity.length} ${activity.length === 1 ? 'movement' : 'movements'} shown`}</p></div>
          <form action="/activity" method="get" className="activity-filters">
            <label htmlFor="activity-location">Location</label>
            <select id="activity-location" name="location" defaultValue={locationId}><option value="">All locations</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select>
            <label htmlFor="activity-type">Movement type</label>
            <select id="activity-type" name="type" defaultValue={movementType}><option value="all">All types</option>{movementTypes.map((type) => <option key={type} value={type}>{type === 'receiving' ? 'Receiving' : type[0].toUpperCase() + type.slice(1)}</option>)}</select>
            <label htmlFor="activity-search">Search product, SKU, or reason</label>
            <input id="activity-search" type="search" name="q" maxLength={100} placeholder="Search activity" defaultValue={search} />
            {!user.publicDemo && <><label htmlFor="activity-actor">Recorded by</label>
            <select id="activity-actor" name="actor" defaultValue={actorId}><option value="">Anyone</option><option value="legacy">Legacy entries</option>{actors.map((actor) => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></>}
            <label htmlFor="activity-from">From date (UTC)</label>
            <input id="activity-from" type="date" name="from" defaultValue={safeFromDate} />
            <label htmlFor="activity-to">Through date (UTC)</label>
            <input id="activity-to" type="date" name="to" defaultValue={safeToDate} />
            {reversedDateRange && <p className="activity-filter-error" role="alert">The start date must be on or before the end date. The date filters were cleared.</p>}
            <button className="button button-secondary" type="submit">Apply filters</button>
            {hasFilters && <Link className="activity-clear" href="/activity">Clear filters</Link>}
          </form>
        </div>

        {activity.length === 0 ? (
          <div className="empty-state"><div className="empty-icon" aria-hidden="true">↗</div><h3>{hasFilters ? 'No matching movements' : 'No stock activity yet'}</h3><p>{hasFilters ? 'Try changing or clearing the selected filters.' : user.publicDemo ? 'The sample database has no stock movements yet.' : 'Once stock is received or deducted, each change will appear here with a signed quantity and reason.'}</p>{hasFilters ? <Link className="button button-secondary" href="/activity">Clear filters</Link> : !user.publicDemo && <Link className="button button-primary" href="/stock">Record the first stock change</Link>}</div>
        ) : (
          <div className="table-scroll"><table className="product-table activity-table"><caption className="sr-only">Newest stock movements first, with signed unit changes.</caption><thead><tr><th scope="col">Date and time (UTC)</th><th scope="col">Product</th><th scope="col">Location</th><th scope="col">Type</th><th scope="col">Change</th><th scope="col">Reason</th><th scope="col">Recorded by</th></tr></thead><tbody>
            {activity.map((movement) => {
              const positive = BigInt(movement.quantityDelta) > BigInt(0);
              const delta = BigInt(movement.quantityDelta);
              const formatted = `${positive ? '+' : '−'}${positive ? delta.toString() : (-delta).toString()} ${delta === BigInt(1) || delta === BigInt(-1) ? 'unit' : 'units'}`;
              return <tr key={movement.id}><td data-label="Date and time (UTC)"><time dateTime={movement.occurredAt}>{new Date(movement.occurredAt).toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' })}</time></td><td data-label="Product"><span className="product-name">{movement.productName}</span><span className="product-subtitle">{movement.sku}</span></td><td data-label="Location">{movement.locationName}</td><td data-label="Type"><span className={`movement-type movement-${movement.movementType}`}>{movement.movementType === 'receiving' ? 'Receiving' : movement.movementType[0].toUpperCase() + movement.movementType.slice(1)}</span></td><td data-label="Change"><strong className={positive ? 'delta-positive' : 'delta-negative'}>{formatted}</strong></td><td data-label="Reason">{movement.reason}</td><td data-label="Recorded by">{movement.actorName ?? <span className="muted">Legacy entry</span>}</td></tr>;
            })}
          </tbody></table></div>
        )}
      </section>
      <p className="catalog-footnote">Showing the latest 200 matching entries at most. Corrections are recorded as a new movement; existing history is not edited.</p>
    </main>
  );
}
