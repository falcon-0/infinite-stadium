import { createHash } from 'node:crypto';
import { integratedFeed, matchState } from './match-stream.js';
import { fixtureSettings, supportedFixtureKind } from './fixture-settings.js';

const maximumBytes = 1572864,
  maximumEventRevisions = 1000,
  maximumFrameRevisions = 5000;
const reference = (record, type) => ({ type, id: record.id, revision: record.revision });
const receivedOrder = (a, b) =>
  a.arrivedAt - b.arrivedAt ||
  a.time - b.time ||
  a.id.localeCompare(b.id) ||
  a.revision - b.revision;
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const contentDigest = (payload) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(payload)))
    .digest('hex');

/** Server-owned fictional fixture export. Each actual received revision occurs
 * once; the current snapshot references that dictionary instead of duplicating
 * 22-player frames. No model, remote data source or interpolation is involved.
 */
export function exportSyntheticDataset(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length !== 3 ||
    !['kind', 'seed', 'observedAt'].every((field) => Object.hasOwn(input, field))
  )
    throw new TypeError('Provide only kind, seed and observedAt for a synthetic dataset export.');
  const { kind, seed, observedAt } = input,
    { horizon } = fixtureSettings(kind);
  if (
    !supportedFixtureKind(kind) ||
    !Number.isSafeInteger(seed) ||
    seed < 0 ||
    seed > 100000 ||
    !Number.isFinite(observedAt) ||
    observedAt < 0 ||
    observedAt > horizon
  )
    throw new RangeError(
      'Choose a supported synthetic fixture, integer seed from 0 to 100000 and a time within its received horizon.',
    );
  const feed = integratedFeed(kind, seed),
    state = matchState({ kind, seed, time: observedAt }, feed);
  const events = feed.events
    .filter((record) => record.arrivedAt <= observedAt && record.time <= observedAt)
    .sort(receivedOrder);
  const frames = feed.frames
    .filter((record) => record.arrivedAt <= observedAt && record.time <= observedAt)
    .sort(receivedOrder);
  if (events.length > maximumEventRevisions || frames.length > maximumFrameRevisions)
    throw new RangeError('Synthetic dataset revision count exceeds its export limit.');
  const phaseLabels = [];
  for (const [type, records] of [
    ['event', events],
    ['frame', frames],
  ])
    for (const record of records) {
      const continuous = fixtureSettings(kind).horizon === 120;
      const phase =
        kind === 'extended'
          ? type === 'frame'
            ? record.phase
            : record.time >= 360
              ? 'complete'
              : record.time % 30 < 20
                ? 'reset'
                : 'attack'
          : continuous
            ? 'continuous-authored-passage'
            : 'authored-scene';
      phaseLabels.push({
        reference: reference(record, type),
        phase,
        scriptedReset: phase === 'reset',
        source:
          kind === 'extended'
            ? type === 'frame'
              ? 'supplied-frame-phase'
              : 'authored-phase-timing'
            : continuous
              ? 'continuous-authored-passage'
              : 'short-authored-scene',
        ...(record.operation === 'delete' ? { withdrawal: true } : {}),
      });
    }
  const payload = {
    schema: 'infinite-stadium.synthetic-dataset.v1',
    source: 'server-generated-fictional-fixture',
    synthetic: true,
    fixture: state.metadata,
    observedAt,
    coordinateUnits: {
      eventLocations: {
        unit: 'normalized-percent',
        xRange: [0, 100],
        yRange: [0, 100],
        xMetresPerUnit: 1.05,
        yMetresPerUnit: 0.68,
      },
      trackingLocations: { unit: 'metres', pitchLength: 105, pitchWidth: 68 },
      limitation:
        'Coordinates are authored samples. Endpoint separation does not measure the ball path, pass difficulty, tactical pressure or top speed.',
    },
    eventSemantics: {
      pass: {
        pendingResult: null,
        pendingEndpoints: 'endX and endY remain null until a received outcome confirmation',
        completedResult: true,
        failedResult: false,
        confirmation: 'Authored reception or opponent recovery confirms the fixture pass outcome.',
      },
      shot: { goalResult: true, noGoalResult: false, pendingResult: null },
      receive:
        'An authored successful reception in this fixture, not a universal provider receipt definition.',
      recovery:
        'Authored ball recovery or collection; an optional reason identifies the collection or possession change.',
      flight: 'An authored ball-flight sample linked to its shotId.',
      delete:
        'A received provider tombstone withdraws that event ID; missing action fields are intentionally preserved.',
    },
    resets: {
      explicitlyAuthored: true,
      enabled: kind === 'extended',
      durationSeconds: kind === 'extended' ? 20 : 0,
      phasePeriodSeconds: kind === 'extended' ? 30 : null,
      limitation:
        kind === 'extended'
          ? 'Each thirty-second phase begins with twenty seconds of scripted positional reset. Reset samples are not observed football play or evidence of tactical movement.'
          : 'This short authored fixture has no twenty-second reset sequence.',
    },
    received: {
      events,
      frames,
      eventRefs: events.map((record) => reference(record, 'event')),
      frameRefs: frames.map((record) => reference(record, 'frame')),
      phaseLabels,
    },
    current: {
      encoding: 'revision-references-to-received-records',
      eventRefs: state.events.map((record) => reference(record, 'event')),
      frameRefs: state.frames.map((record) => reference(record, 'frame')),
      stats: state.stats,
      passOutcomes: state.passOutcomes,
    },
    counts: {
      receivedEventRevisions: events.length,
      receivedFrameRevisions: frames.length,
      currentEvents: state.events.length,
      currentFrames: state.frames.length,
      receivedEventDeletes: events.filter((record) => record.operation === 'delete').length,
      receivedFrameDeletes: frames.filter((record) => record.operation === 'delete').length,
      correctedEventRevisions: events.filter(
        (record) => record.revision > 1 && record.operation !== 'delete',
      ).length,
      correctedFrameRevisions: frames.filter(
        (record) => record.revision > 1 && record.operation !== 'delete',
      ).length,
      resetFrameRevisions: phaseLabels.filter(
        (label) => label.reference.type === 'frame' && label.scriptedReset,
      ).length,
    },
    replay: {
      cutoffField: 'arrivedAt',
      identityFields: ['type', 'id'],
      revisionField: 'revision',
      rule: 'At a replay observation time, retain only rows with arrivedAt and event/sample time no later than that time; select the highest received revision per typed ID; remove IDs whose latest record is a delete. Current refs resolve the exact record in the received arrays.',
      ordering:
        'Raw revisions are ordered by arrival time, source time, ID and revision. Current events and frames are ordered by source time and ID.',
      tracking:
        'Resolve current.frameRefs against received.frames. Do not invent interpolation or convert reset samples into match actions.',
    },
    limits: {
      maximumEventRevisions,
      maximumFrameRevisions,
      maximumSerializedBytes: maximumBytes,
      serialization: 'minified-json-utf8',
    },
    limitation:
      'Fictional synthetic data generated by this prototype; not redistributed Premier League match data, real video, a complete match or a validated football simulator. Counts describe this received inventory. No model output, API credentials or execution traces are included.',
  };
  const result = {
    ...payload,
    contentHash: {
      algorithm: 'sha256',
      value: contentDigest(payload),
      scope: 'canonical-json-of-export-excluding-contentHash',
      limitation:
        'Deterministic content identity, not signed provenance or proof of football realism.',
    },
  };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maximumBytes)
    throw new RangeError('Synthetic dataset exceeds its minified UTF-8 export byte limit.');
  return structuredClone(result);
}
