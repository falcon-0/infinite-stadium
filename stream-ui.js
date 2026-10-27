import { captureQuestionMoment } from './match-chat-state.js';
import { watchSnapshot } from './watch-snapshot.js';
import { emptyStream, applyStream } from './stream-state.js';
import { selectLiveStory, momentScene } from './viewer-story.js';
import { catchup } from './catchup.js';
import { livePlayHeadline, momentHeadline, momentSummary } from './viewer-copy.js';
import { InvestigationCache } from './investigation-cache.js';
import { buildStoryCue } from './producer-cue.js';
import { playerFocus } from './player-focus.js';
import { recapViewKey, currentRecap } from './recap-view.js';
import { createStudioPreview, studioPreviewState } from './studio-preview.js';
import {
  defaultViewerPreferences,
  loadViewerPreferences,
  saveViewerPreferences,
  clearViewerPreferences,
  isSafePlayerName,
} from './viewer-preferences.js';
import { recordedMomentPath } from './moment-path.js';
import { fixtureSettings, fixtureTeams, matchCatalogue } from './fixture-settings.js';
import { matchPicture } from './match-picture.js';
import { matchChange } from './match-change.js';
import { initializeProducerReview } from './producer-review-ui.js';
import { preferenceRefreshSnapshot, ViewerRefresh } from './viewer-refresh.js';
import { viewerMoments } from './viewer-moments.js';
import { PitchPlayback } from './pitch-motion.js';
import { drawPitchPlayers } from './pitch-renderer.js';
import { buildMomentReplay, MomentReplay } from './moment-replay.js';
import { momentMeaning } from './moment-meaning.js';
import { createFanMomentCard, additionalFanClaims } from './fan-experience.js';
import { initializeProductionDesk } from './production-desk-ui.js';
import { initializeMatchChat } from './match-chat-ui.js';
import { chooseWatchInsight, watchExplanation } from './watch-insights.js';
const requestedView = new URLSearchParams(location.search).get('view') || 'watch';
const siteView = requestedView === 'studio' ? 'watch' : requestedView;
if (requestedView === 'studio') {
  const url = new URL(location.href);
  url.searchParams.set('view', 'watch');
  history.replaceState(null, '', url);
}
const developerView = siteView === 'developer',
  studioView = siteView === 'studio';
document.body.classList.add(
  developerView ? 'developer-view' : studioView ? 'studio-view' : 'fan-view',
);
const viewNavigation = document.createElement('nav');
viewNavigation.className = 'view-navigation';
viewNavigation.setAttribute('aria-label', 'Workspace');
viewNavigation.innerHTML = `<a href="/?view=watch" ${!developerView ? 'aria-current="page"' : ''}>Matches</a>`;
document.querySelector('header').append(viewNavigation);
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const usageCopy = (execution) =>
  execution?.usage
    ? ` · ${execution.usage.promptTokens} input / ${execution.usage.completionTokens} output tokens`
    : '';
const stamp = (t) =>
  `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
document.querySelector('.intro').insertAdjacentHTML(
  'afterend',
  `
<section class="investigation" aria-labelledby="unified-title">
 <div class="audience-heading"><div><p class="eyebrow">ONE RECEIVED MATCH STREAM</p><h2 id="unified-title">Live intelligence lab.</h2></div><span class="pill">SYNTHETIC REPLAY</span></div>
 <p class="disclosure">Events, player positions, timed narratives and recaps share one fixture. The six-minute segment contains scripted attacks and reset intervals. Live cards below use deterministic templates; AI drafts are generated only when requested.</p>
 <div class="demo-controls"><label for="unified-kind">Fixture <select id="unified-kind" aria-label="Fixture"><option value="extended">Six-minute segment</option><option value="central">Central sequence</option><option value="wide">Wide sequence</option></select></label><label for="unified-audience">Audience <select id="unified-audience" aria-label="Audience"><option value="newcomer">Newcomer</option><option value="analyst">Analyst</option><option value="player">Player follower</option></select></label><label for="unified-language">Language <select id="unified-language" aria-label="Language"><option value="en">English</option><option value="es">Spanish</option><option value="fr">French</option><option value="pt">Portuguese</option></select></label><label for="unified-club">Favorite club <select id="unified-club" aria-label="Favorite club"><option value="">Any club</option><option value="home">Northbridge</option><option value="away">Harbour Athletic</option></select></label><label for="unified-player">Favorite player <select id="unified-player" aria-label="Favorite player"><option value="">Any player</option><option>A. Reed</option><option>J. Cole</option></select></label></div>
 <div class="controls"><button id="unified-play">Play stream</button><button id="unified-reset" class="secondary">Restart stream</button><button id="unified-demo" class="secondary">Inspect correction demo</button><label for="unified-speed">Speed <select id="unified-speed" aria-label="Speed"><option value="1" selected>1×</option><option value="4">4×</option><option value="12">12×</option></select></label><b id="unified-clock">00:00</b><b id="unified-score">0 : 0</b></div>
 <label for="unified-time">Match timeline</label><input id="unified-time" type="range" min="0" max="362" value="0" step="1">
 <p id="unified-status" role="status" aria-live="polite">Loading received stream…</p>
 <div class="workspace"><div><svg id="unified-pitch" viewBox="0 0 1050 680" role="img" aria-label="Received positions in the unified synthetic match"><rect width="1050" height="680" fill="#123f36"/><g stroke="#87b2a1" fill="none"><rect x="5" y="5" width="1040" height="670"/><path d="M525 0V680"/><circle cx="525" cy="340" r="91.5"/><rect x="0" y="138.5" width="165" height="403"/><rect x="885" y="138.5" width="165" height="403"/></g><g id="unified-positions"></g></svg><p id="unified-frame" class="disclosure"></p><div id="unified-overlays" aria-label="Active timed narratives"></div></div><aside><div class="section-heading"><h2>Received match events</h2></div><div id="unified-feed" class="feed"></div></aside></div>
 <h3>Recap so far</h3><p id="unified-summary"></p><div id="unified-recap"></div>
 <h3>Selected moment</h3><div id="unified-explanation">Select a received event to inspect its evidence.</div>
 <div class="ai-controls"><button id="unified-draft" disabled>Generate moment AI draft</button><button id="unified-agent" class="secondary" disabled>Investigate with agents</button><span id="unified-ai-status" role="status" aria-live="polite">Checking AI configuration…</span></div><div id="unified-ai-result" class="ai-draft"></div>
</section>`,
);
const $ = (id) => document.getElementById(`unified-${id}`);
const markupCache = new WeakMap();
function updateMarkup(element, html) {
  const previous = markupCache.get(element);
  if (previous?.html === html && previous.firstChild === element.firstChild) return;
  const focused = element.contains(document.activeElement) ? document.activeElement : null;
  const eventId = focused?.dataset.unifiedEvent;
  const playerEventId = focused?.dataset.focusEvent;
  const momentEventId = focused?.dataset.momentAnchor;
  const cueFocus = focused?.hasAttribute('data-studio-cue');
  const openSummaries = [...element.querySelectorAll('details[open]')].map(
    (d) => d.querySelector('summary')?.textContent,
  );
  const summaryFocus = focused?.tagName === 'SUMMARY' ? focused.textContent : null;
  element.innerHTML = html;
  markupCache.set(element, { html, firstChild: element.firstChild });
  for (const details of element.querySelectorAll('details'))
    if (openSummaries.includes(details.querySelector('summary')?.textContent)) details.open = true;
  if (eventId)
    [...element.querySelectorAll('[data-unified-event]')]
      .find((button) => button.dataset.unifiedEvent === eventId)
      ?.focus({ preventScroll: true });
  if (playerEventId) {
    const replacement = [...element.querySelectorAll('[data-focus-event]')].find(
      (button) => button.dataset.focusEvent === playerEventId,
    );
    (replacement || element.querySelector('summary'))?.focus({ preventScroll: true });
  }
  if (momentEventId) {
    const replacement = [...element.querySelectorAll('[data-moment-anchor]')].find(
      (button) => button.dataset.momentAnchor === momentEventId,
    );
    (replacement || element.closest('details')?.querySelector('summary'))?.focus({
      preventScroll: true,
    });
  }
  if (cueFocus)
    (element.querySelector('[data-studio-cue]') || element.querySelector('summary'))?.focus({
      preventScroll: true,
    });
  if (summaryFocus)
    [...element.querySelectorAll('summary')]
      .find((summary) => summary.textContent === summaryFocus)
      ?.focus({ preventScroll: true });
  if (focused && !focused.isConnected && !element.contains(document.activeElement)) {
    const fallback =
      element.querySelector('button:not(:disabled),summary') ||
      element.closest('details')?.querySelector('summary');
    fallback?.focus({ preventScroll: true });
  }
}
const lab = $('title').closest('section');
$('title').textContent = 'Match insights';
lab.querySelector('.eyebrow').textContent = 'NORTHBRIDGE · HARBOUR ATHLETIC';
lab.querySelector(':scope > .disclosure').textContent =
  'A fictional match replay. Live insights use recorded evidence; AI explanations are available on request.';
const preferencesPanel = document.createElement('details');
preferencesPanel.className = 'viewer-preferences';
preferencesPanel.innerHTML =
  '<summary>Personalize your view</summary><div class="demo-controls"></div>';
let appliedViewerProfile = defaultViewerPreferences(),
  rosterOptionsKey = null;
const withdrawalOption = document.createElement('option');
withdrawalOption.value = 'withdrawal';
withdrawalOption.textContent = 'Goal event withdrawal';
$('kind').append(withdrawalOption);
for (const [value, label] of [
  ['sustained', 'Continuous buildup'],
  ['interrupted', 'Interrupted attack'],
  ['quiet', 'Quiet possession'],
  ['counter', 'Counterattacking passage'],
  ['duel', 'End-to-end passage'],
]) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  $('kind').append(option);
}
$('language').closest('label').firstChild.textContent = 'Story language ';
$('language').setAttribute('aria-label', 'Story language');
for (const id of ['audience', 'language', 'club', 'player'])
  preferencesPanel.lastElementChild.append($(id).closest('label'));
const resetPreferences = document.createElement('button');
resetPreferences.className = 'secondary';
resetPreferences.textContent = 'Reset preferences';
const preferencesStatus = document.createElement('p');
preferencesStatus.className = 'disclosure';
preferencesStatus.setAttribute('role', 'status');
preferencesPanel.append(resetPreferences, preferencesStatus);
const applyPreferences = document.createElement('button');
applyPreferences.type = 'button';
applyPreferences.textContent = 'Apply view';
applyPreferences.className = 'apply-view';
lab.querySelector('.controls').before(preferencesPanel);
const tools = document.createElement('details');
tools.className = 'testing-tools';
tools.innerHTML = '<summary>Testing tools</summary><div class="demo-controls"></div>';
for (const id of ['kind', 'reset', 'demo', 'speed', 'agent'])
  tools.lastElementChild.append(id === 'kind' || id === 'speed' ? $(id).closest('label') : $(id));
lab.querySelector('.demo-controls').remove();
tools.append($('frame'));
const studioPanel = document.createElement('details');
studioPanel.className = 'studio-preview';
studioPanel.innerHTML =
  '<summary>Studio cue preview</summary><p class="disclosure">Local synthetic replay preview. Human review is required; nothing is broadcast.</p><div class="ai-controls"><button id="unified-studio-preview" class="secondary" disabled>Preview current studio cue</button><button id="unified-studio-clear" class="secondary" disabled>Clear preview</button></div><p id="unified-studio-status" role="status" aria-live="polite">Choose an existing AI-selected moment story to preview.</p><div id="unified-studio-result" role="region" aria-label="Local studio cue preview"></div>';
tools.append(studioPanel);
const datasetPanel = document.createElement('details');
datasetPanel.className = 'dataset-export';
datasetPanel.innerHTML =
  '<summary>Synthetic dataset</summary><p class="disclosure">Download this fixture through the current received time, including actual corrections and tracking samples. Fictional data with explicit scripted resets.</p><button id="unified-dataset-download" class="secondary" disabled>Download received dataset</button><p id="unified-dataset-status" role="status"></p>';
tools.append(datasetPanel);
lab.querySelector('.controls').after($('status'));
$('status').className = 'replay-status disclosure';
lab.after(tools);
// The main side panel is the moment explanation; the event log is optional.
const workspace = lab.querySelector('.workspace'),
  eventPanel = workspace.querySelector('aside');
tools.append(eventPanel);
const momentPanel = document.createElement('aside');
momentPanel.className = 'moment-panel';
let fanCard = null;
const momentHeading = $('explanation').previousElementSibling;
momentHeading.textContent = 'Understand the moment';
momentPanel.append(
  momentHeading,
  $('explanation'),
  lab.querySelector('.ai-controls'),
  $('ai-result'),
);
const playerSpotlight = document.createElement('div');
playerSpotlight.className = 'player-spotlight';
playerSpotlight.hidden = true;
momentHeading.after(playerSpotlight);
workspace.append(momentPanel);
const inspectionStatus = document.createElement('p');
inspectionStatus.id = 'unified-inspection-status';
inspectionStatus.className = 'disclosure';
inspectionStatus.setAttribute('role', 'status');
inspectionStatus.hidden = false;
$('explanation').before(inspectionStatus);
const recapPanel = document.createElement('details');
recapPanel.className = 'recap-panel';
recapPanel.innerHTML = '<summary>Match recap</summary>';
$('summary').previousElementSibling.remove();
recapPanel.append($('summary'), $('recap'));
lab.append(recapPanel);
const catchupPanel = document.createElement('div');
catchupPanel.className = 'catchup-panel';
catchupPanel.innerHTML =
  '<div class="catchup-controls"><label for="unified-lookback">Catch up on <select id="unified-lookback"><option value="30">the last 30 seconds</option><option value="60">the last minute</option><option value="all">the segment so far</option></select></label><button id="unified-catchup" class="secondary">Catch me up</button></div><div id="unified-catchup-result" role="region" aria-label="Your catch-up summary"></div>';
recapPanel.querySelector('summary').after(catchupPanel);
const recapAI = document.createElement('div');
recapAI.className = 'recap-ai';
recapAI.innerHTML =
  '<div class="ai-controls"><button id="unified-recap-draft" class="secondary" disabled>Create AI recap</button><span id="unified-recap-ai-status" role="status" aria-live="polite"></span></div><div id="unified-recap-ai-result" class="ai-draft"></div>';
$('summary').before(recapAI);
const accessPanel = document.createElement('details');
accessPanel.id = 'unified-access';
accessPanel.className = 'ai-access';
accessPanel.hidden = true;
accessPanel.open = true;
accessPanel.innerHTML =
  '<summary>Enable AI access</summary><form id="unified-access-form"><p>Enter the demo access code from the project description to ask the AI.</p><label for="unified-access-code">Project access code</label><input id="unified-access-code" type="password" autocomplete="off" maxlength="512" required><button type="submit" class="secondary">Unlock AI</button><p class="disclosure">The code stays out of browser storage. Access expires after one hour.</p></form>';
lab.querySelector('.ai-controls').append(accessPanel);
const lockAccess = document.createElement('button');
lockAccess.id = 'unified-lock-access';
lockAccess.className = 'secondary';
lockAccess.textContent = 'Lock AI access';
lockAccess.hidden = true;
tools.querySelector(':scope > .demo-controls').append(lockAccess);
$('draft').textContent = 'Explain this moment';
$('time').previousElementSibling.className = 'sr-only';
// Keep earlier independent fixtures available without presenting them as part
// of the unified match. Existing event handlers and evidence demos still work.
const legacy = document.createElement('details');
legacy.className = 'legacy-labs';
legacy.innerHTML =
  '<summary>Open independent evidence and fixture labs</summary><p class="disclosure">These earlier demos use separate fixtures and clocks. Their results are independent of the unified match above.</p>';
const firstLegacy = document.querySelector('section.workspace'),
  footer = document.querySelector('footer');
for (let node = firstLegacy; node && node !== footer; ) {
  const next = node.nextSibling;
  legacy.append(node);
  node = next;
}
tools.append(legacy);
const pitchCaption = document.createElement('p');
pitchCaption.id = 'unified-scene-caption';
pitchCaption.className = 'scene-caption';
$('pitch').after(pitchCaption);
const pathCaption = document.createElement('p');
pathCaption.id = 'unified-path-caption';
pathCaption.className = 'scene-caption endpoint-caption';
pathCaption.hidden = true;
pitchCaption.after(pathCaption);
const returnButton = document.createElement('button');
returnButton.id = 'unified-current';
returnButton.className = 'secondary';
returnButton.textContent = 'Follow current play';
lab.querySelector('.controls').append(returnButton);
const modeLabel = document.createElement('span');
modeLabel.id = 'unified-view-mode';
modeLabel.className = 'view-mode';
lab.querySelector('.controls').append(modeLabel);
const catchupShortcut = document.createElement('button');
catchupShortcut.className = 'secondary';
catchupShortcut.textContent = 'Catch me up';
lab.querySelector('.controls').append(catchupShortcut);
const exampleButton = document.createElement('button');
exampleButton.className = 'secondary';
exampleButton.textContent = 'Explore a two-minute example';
lab.querySelector('.controls').append(exampleButton);
const mainFixtureButton = document.createElement('button');
mainFixtureButton.className = 'secondary';
mainFixtureButton.textContent = 'Return to six-minute replay';
mainFixtureButton.hidden = true;
lab.querySelector('.controls').append(mainFixtureButton);
const fixtureIdentity = document.createElement('p');
fixtureIdentity.className = 'disclosure';
fixtureIdentity.id = 'unified-fixture-identity';
lab.querySelector('.controls').before(fixtureIdentity);
const finishPanel = document.createElement('div');
finishPanel.className = 'replay-finish';
finishPanel.hidden = true;
finishPanel.innerHTML =
  '<p class="finish-label">Replay complete</p><p data-finish-summary></p><button class="secondary" data-open-recap>View recap</button>';
workspace.before(finishPanel);
finishPanel.querySelector('[data-open-recap]').onclick = () => {
  recapPanel.hidden = false;
  recapPanel.open = true;
  recapPanel.querySelector('summary').focus();
  recapPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
const momentsPanel = document.createElement('details');
momentsPanel.className = 'key-moments';
momentsPanel.innerHTML = '<summary>Key moments</summary><div></div>';
workspace.before(momentsPanel);
momentsPanel.onclick = (event) => {
  const button = event.target.closest('[data-moment-anchor]');
  if (!button || viewerRefresh.blocked) return;
  generationController?.abort();
  stop();
  followLatest = false;
  anchor = button.dataset.momentAnchor;
  render();
  inspect();
  momentHeading.scrollIntoView({ behavior: 'smooth', block: 'start' });
  momentHeading.setAttribute('tabindex', '-1');
  momentHeading.focus({ preventScroll: true });
};
const picturePanel = document.createElement('details');
picturePanel.className = 'match-picture';
picturePanel.innerHTML =
  '<summary>Match picture</summary><div class="match-picture-content"></div>';
recapPanel.before(picturePanel);
const changePanel = document.createElement('div');
changePanel.className = 'match-change';
changePanel.hidden = true;
workspace.before(changePanel);
const clockLabel = document.createElement('span');
clockLabel.className = 'clock-label';
clockLabel.textContent = 'Replay time';
$('clock').before(clockLabel);
let state = emptyStream(),
  stream = null,
  playing = false,
  anchor = null,
  selected = null,
  configured = false,
  busy = false,
  draft = null,
  draftPreferences = null,
  followLatest = true;
const viewerRefresh = new ViewerRefresh();
let refreshFrame = null;
let generationController = null,
  generationTimer = null,
  generationTask = null,
  provider = null,
  catchupPreferences = null,
  catchupObservedAt = null,
  focusedPlayer = null,
  recapDraft = null,
  recapDraftPreferences = null,
  recapDraftReceivedKey = null,
  recapError = null;
let studioPreview = null,
  studioResult = null,
  studioValidatedKey = null;
let recapExportController = null;
let datasetController = null;
let aiUnavailableReason = null,
  questionAvailable = true;
let aiAvailabilityMessage = 'Checking AI configuration…';
const generationElapsed = document.createElement('span');
generationElapsed.className = 'disclosure';
generationElapsed.setAttribute('aria-live', 'off');
generationElapsed.hidden = true;
$('ai-status').after(generationElapsed);
let selectedSeed = 17;
const readPreferenceControls = () => ({
  audience: $('audience').value,
  language: $('language').value,
  favoriteClub: $('club').value || null,
  favoritePlayer: $('player').value || null,
});
const preferences = () => ({
  kind: $('kind').value,
  seed: selectedSeed,
  ...(!developerView && !studioView ? appliedViewerProfile : readPreferenceControls()),
});
const preferencesKey = () => JSON.stringify(preferences());
const preferenceStorage = () => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};
const producerReview =
  studioView || developerView
    ? initializeProducerReview({
        parent: lab,
        getState: () => state,
        getPreferences: preferences,
        isRefreshing: () => viewerRefresh.blocked,
        getAIStory: () =>
          !viewerRefresh.blocked &&
          selected &&
          draft?.status === 'draft' &&
          draft.authorship?.wording === 'application-fact-templates' &&
          preferencesKey() === draftPreferences &&
          [selected.key, selected.investigationKey].includes(draft.key)
            ? { draft, explanation: selected, time: state.time, preferences: preferences() }
            : null,
        onInspect: (id) => {
          if (viewerRefresh.blocked) return;
          generationController?.abort();
          stop();
          followLatest = false;
          anchor = id;
          render();
          inspect();
        },
      })
    : { update() {} };
const productionDesk = studioView
  ? initializeProductionDesk({
      parent: lab,
      getState: () => state,
      getPreferences: preferences,
      getAIStory: () =>
        selected &&
        draft?.status === 'draft' &&
        draft.authorship?.wording === 'application-fact-templates' &&
        preferencesKey() === draftPreferences &&
        [selected.key, selected.investigationKey].includes(draft.key)
          ? { draft }
          : null,
      onSeek: (time) => {
        $('kind').value = 'sustained';
        anchor = 'comparison-sustained-17-shot-96';
        followLatest = false;
        connect(time, false);
      },
      onInspect: (id) => {
        generationController?.abort();
        stop();
        followLatest = false;
        anchor = id;
        render();
        inspect();
        const replay = lab.querySelector('.production-replay');
        replay.open = true;
        replay.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      onAI: async (id) => {
        if (!selected || selected.anchorId !== id)
          throw new Error(
            'Inspect this chance on the pitch first, then request its AI investigation.',
          );
        await generate(false, true);
      },
    })
  : null;
const matchChat = !developerView
  ? initializeMatchChat({
      parent: studioView ? lab : momentPanel,
      showSources: studioView,
      allowRecordedSearch: studioView,
      onRequestSettled: () => refreshAIStatus({ preserveStatus: true }),
      getContext: () => ({
        ...preferences(),
        ...captureQuestionMoment({
          time: state.time,
          displayTime: playing ? pitchPlayback.time : null,
          following: followLatest,
          anchorId: anchor,
        }),
        matchId: state.matchId,
        configured: configured && questionAvailable,
        provider,
        aiUnavailableReason: !questionAvailable && configured ? 'budget' : aiUnavailableReason,
        eventRevisions: new Map([...state.eventHistory.values()].map((e) => [e.id, e.revision])),
        eventRecords: [...state.eventHistory.values()],
      }),
      onInspect: (id) => {
        generationController?.abort();
        stop();
        followLatest = false;
        anchor = id;
        render();
        inspect();
        if (studioView) {
          const replay = lab.querySelector('.production-replay');
          replay.open = true;
          replay.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      },
    })
  : null;
tools.hidden = !developerView;
if (studioView) lab.querySelector('.producer-review').open = false;
picturePanel.querySelector('summary').after(changePanel);
workspace.after(finishPanel, momentsPanel);
const developerLink = document.createElement('a');
developerLink.href = '/?view=developer';
developerLink.textContent = 'Developer workspace';
developerLink.className = 'developer-link';
document.querySelector('footer').append(developerLink);
if (!developerView && !studioView) {
  developerLink.hidden = true;
  document.querySelector('footer span').textContent =
    'Synthetic football demo - fictional clubs and players';
}
if (!developerView) {
  const sidebar = document.createElement('aside');
  sidebar.className = 'app-sidebar';
  sidebar.setAttribute('aria-label', 'Infinite Stadium navigation');
  const sidebarHeading = document.createElement('p');
  sidebarHeading.className = 'sidebar-heading';
  sidebarHeading.textContent = 'Match intelligence';
  sidebar.append(document.querySelector('header .brand'), sidebarHeading, viewNavigation);
  document.body.prepend(sidebar);
  document.querySelector('header .pill').textContent = studioView
    ? 'Studio workspace'
    : 'Match intelligence';
}
const scoreStrip = document.createElement('div');
scoreStrip.className = 'match-score-strip';
scoreStrip.innerHTML =
  '<div class="score-club"><span class="club-badge home" aria-hidden="true">N</span><span>Northbridge</span></div><div class="score-centre"></div><div class="score-club away"><span>Harbour Athletic</span><span class="club-badge away" aria-hidden="true">H</span></div>';
const scoreCentre = scoreStrip.querySelector('.score-centre');
scoreCentre.append($('score'), $('clock'));
lab.querySelector('.audience-heading').after(scoreStrip);
const playerControls = lab.querySelector('.controls');
const replayProgress = document.createElement('div');
replayProgress.className = 'replay-progress';
replayProgress.append($('time'));
const replayElapsed = document.createElement('span'),
  replayDuration = document.createElement('span');
for (const label of [replayElapsed, replayDuration]) {
  label.className = 'replay-time';
  label.setAttribute('aria-hidden', 'true');
}
replayProgress.prepend(replayElapsed);
replayProgress.append(replayDuration);
workspace.firstElementChild.append(playerControls, replayProgress);
const pitchLegend = document.createElement('div');
pitchLegend.className = 'pitch-legend';
pitchLegend.innerHTML =
  '<span><i class="home"></i>Northbridge</span><span><i class="away"></i>Harbour Athletic</span><span class="synthetic-label">Fictional match · sampled positions</span>';
$('pitch').before(pitchLegend);
pitchLegend.append(playerControls);
$('pitch').insertAdjacentHTML(
  'afterbegin',
  '<defs><pattern id="unified-turf" width="150" height="680" patternUnits="userSpaceOnUse"><rect width="75" height="680" fill="#174a39"/><rect x="75" width="75" height="680" fill="#1b513e"/></pattern></defs>',
);
$('pitch').querySelector(':scope > rect').setAttribute('fill', 'url(#unified-turf)');
$('pitch').setAttribute('viewBox', '-30 -20 1110 720');
$('positions').insertAdjacentHTML(
  'beforebegin',
  '<g stroke="#94bdac" stroke-width="1.6" fill="none" opacity=".7"><rect x="0" y="248.4" width="55" height="183.2"/><rect x="995" y="248.4" width="55" height="183.2"/><rect x="-24" y="303.4" width="24" height="73.2"/><rect x="1050" y="303.4" width="24" height="73.2"/><path d="M-16 304V376 M-8 304V376 M1058 304V376 M1066 304V376 M-24 322H0 M-24 340H0 M-24 358H0 M1050 322H1074 M1050 340H1074 M1050 358H1074" opacity=".4"/><circle cx="110" cy="340" r="2" fill="#94bdac"/><circle cx="940" cy="340" r="2" fill="#94bdac"/><circle cx="525" cy="340" r="3" fill="#94bdac"/></g>',
);
if (!developerView) {
  lab.querySelector('.audience-heading .eyebrow').textContent =
    'INFINITE STADIUM · MATCH INTELLIGENCE';
  $('title').textContent = 'Inside the match.';
  lab.querySelector(':scope > .disclosure').textContent =
    'Follow the play. Understand the moments that matter.';
  lab.querySelector(':scope > .disclosure').classList.add('viewer-tagline');
}
if (!developerView && !studioView) momentHeading.after(preferencesPanel);
if (studioView) {
  $('title').textContent = 'Production desk';
  lab.querySelector('.audience-heading .eyebrow').textContent =
    'INFINITE STADIUM · EXPLAINABLE MATCH PRODUCTION';
  const replayWorkspace = document.createElement('details');
  replayWorkspace.className = 'production-replay';
  replayWorkspace.innerHTML = '<summary>Match replay and AI investigation</summary>';
  workspace.before(replayWorkspace);
  replayWorkspace.append(workspace);
  productionDesk.panel.after(replayWorkspace);
  preferencesPanel.before(productionDesk.panel);
  replayWorkspace.prepend(preferencesPanel);
}
if (!developerView && !studioView) {
  lab.classList.add('watch-surface');
  $('speed').innerHTML = '<option value="2" selected>2×</option>';
  $('speed').closest('label').hidden = true;
  $('title').textContent = 'Match companion';
  lab.querySelector('.audience-heading .eyebrow').textContent = 'WATCH / UNDERSTAND / REPLAY';
  lab.querySelector('.audience-heading .pill').textContent = 'SYNTHETIC MATCH DEMO';
  tools.append(momentsPanel, picturePanel, pathCaption);
  finishPanel.after(recapPanel);
  recapPanel.hidden = true;
  fixtureIdentity.classList.add('watch-fixture-note');
  catchupShortcut.hidden = true;
  preferencesPanel.classList.add('watch-view-options');
  lab.querySelector('.audience-heading').after(preferencesPanel);
  for (const [id, label] of [
    ['audience', 'Match view'],
    ['language', 'Language'],
    ['player', 'Player'],
  ]) {
    $(id).closest('label').firstChild.textContent = label + ' ';
    $(id).setAttribute('aria-label', label);
  }
  const languageHelp = document.createElement('p');
  languageHelp.id = 'unified-language-help';
  languageHelp.className = 'disclosure language-help';
  languageHelp.textContent = 'Match insights, recaps and new match answers use this language.';
  preferencesPanel.querySelector('.demo-controls').after(languageHelp);
  $('language').setAttribute('aria-describedby', languageHelp.id);
  for (const [value, label] of [
    ['newcomer', 'Simple explanations'],
    ['analyst', 'Detailed analysis'],
    ['player', 'Follow a player'],
  ])
    $('audience').querySelector(`option[value="${value}"]`).textContent = label;
  const preferencesActions = document.createElement('div');
  preferencesActions.className = 'view-options-actions';
  preferencesActions.append(resetPreferences, applyPreferences);
  preferencesPanel.append(preferencesActions);
  preferencesPanel.addEventListener('toggle', () => {
    if (!preferencesPanel.open) applyViewerPreferences(appliedViewerProfile);
  });
  const insightPane = document.createElement('section');
  insightPane.className = 'watch-story-banner';
  insightPane.setAttribute('aria-label', 'The match right now');
  insightPane.append($('explanation'));
  workspace.firstElementChild.append(insightPane);
  for (const child of [...momentPanel.children]) if (child !== matchChat.panel) tools.append(child);
  momentPanel.classList.add('watch-conversation');
  momentPanel.append(playerSpotlight, matchChat.panel);
  matchChat.panel.hidden = false;
  pitchLegend.before(scoreStrip);
  tools.append(catchupPanel, recapAI);
  const accessStatus = document.createElement('p');
  accessStatus.id = 'unified-access-status';
  accessStatus.className = 'disclosure';
  accessStatus.setAttribute('role', 'status');
  $('access-code').setAttribute('aria-describedby', accessStatus.id);
  momentPanel.append(accessPanel, accessStatus);
}
const watchMiniScore = document.createElement('div');
watchMiniScore.className = 'watch-mini-score';
const watchMiniLabel = document.createElement('span');
const watchMiniPlay = document.createElement('button');
watchMiniPlay.type = 'button';
watchMiniPlay.className = 'secondary';
watchMiniPlay.addEventListener('click', () => $('play').click());
watchMiniScore.append(watchMiniLabel, watchMiniPlay);
const watchStatsPanel = document.createElement('section');
watchStatsPanel.className = 'watch-stats';
watchStatsPanel.setAttribute('aria-label', 'Match statistics');
if (!developerView && !studioView) {
  const stage = document.createElement('div');
  stage.className = 'watch-stage';
  $('pitch').before(stage);
  stage.append(watchMiniScore, watchStatsPanel, $('pitch'));
}
function renderWatchStats(snapshot) {
  if (developerView || studioView) return;
  watchStatsPanel.lang = preferences().language;
  const totals = (snapshot || watchSnapshot(state.eventHistory.values(), state.time)).totals;
  const miniTeams = fixtureTeams(preferences().kind, preferences().seed);
  watchMiniLabel.textContent = `${miniTeams.home} ${$('score').textContent} ${miniTeams.away} · ${$('clock').textContent}`;
  watchMiniPlay.textContent = playing ? 'Pause' : 'Play';
  watchMiniPlay.setAttribute(
    'aria-label',
    playing ? 'Pause match playback' : 'Resume match playback',
  );
  const copy = {
    en: ['Match stats', 'Shots', 'On target', 'Passes made', 'Ball wins'],
    es: ['Estadísticas', 'Tiros', 'A puerta', 'Pases completos', 'Recuperaciones'],
    fr: ['Statistiques', 'Tirs', 'Cadrés', 'Passes réussies', 'Récupérations'],
    pt: ['Estatísticas', 'Remates', 'À baliza', 'Passes completos', 'Recuperações'],
  }[preferences().language];
  const displayTotals = Object.fromEntries(
    ['home', 'away'].map((team) => [
      team,
      { ...totals[team], ...(totals[team].ballWinsUnknown ? { ballWins: '—' } : {}) },
    ]),
  );
  const unavailable = {
    en: 'Unavailable',
    es: 'No disponible',
    fr: 'Indisponible',
    pt: 'Indisponível',
  }[preferences().language];
  const statValueLabel = (team, field) =>
    displayTotals[team][field] === '—' ? unavailable : displayTotals[team][field];
  updateMarkup(
    watchStatsPanel,
    `<table><caption>${copy[0]}</caption><thead><tr><th scope="col" title="${escape(fixtureTeams(preferences().kind, preferences().seed).home)}">${fixtureTeams(preferences().kind, preferences().seed).home[0]}</th><th scope="col"><span class="sr-only">Statistic</span></th><th scope="col" title="${escape(fixtureTeams(preferences().kind, preferences().seed).away)}">${fixtureTeams(preferences().kind, preferences().seed).away[0]}</th></tr></thead><tbody>${['shots', 'onTarget', 'completedPasses', 'ballWins'].map((field, i) => `<tr><td aria-label="${escape(fixtureTeams(preferences().kind, preferences().seed).home)} ${copy[i + 1]}: ${statValueLabel('home', field)}">${displayTotals.home[field]}</td><th scope="row">${copy[i + 1]}</th><td aria-label="${escape(fixtureTeams(preferences().kind, preferences().seed).away)} ${copy[i + 1]}: ${statValueLabel('away', field)}">${displayTotals.away[field]}</td></tr>`).join('')}</tbody></table>`,
  );
}
let motionFrame = 0;
let livePaint = null,
  livePaintKey = null;
let visiblePaint = null;
window.addEventListener('resize', () => visiblePaint?.refresh?.());
let buildupReplay = null,
  buildupAnimation = 0;
const pitchPlayback = new PitchPlayback();
let watchClockKey = null;
function renderWatchClock(time) {
  if (developerView || studioView || !state.matchId) return;
  const second = Math.floor(Math.min(state.time, time));
  const key = `${state.matchId}:${second}:${state.eventHistory.size}:${preferences().language}`;
  if (key === watchClockKey) return;
  watchClockKey = key;
  const snapshot = watchSnapshot(state.eventHistory.values(), second);
  $('clock').textContent = stamp(second);
  $('score').textContent = `${snapshot.score.home} : ${snapshot.score.away}`;
  const teams = fixtureTeams(preferences().kind, preferences().seed);
  $('score').setAttribute(
    'aria-label',
    `Current replay score: ${teams.home} ${snapshot.score.home}, ${teams.away} ${snapshot.score.away}`,
  );
  renderWatchStats(snapshot);
}
function animatePitch(paint) {
  cancelAnimationFrame(motionFrame);
  if (
    !playing ||
    !followLatest ||
    viewerRefresh.blocked ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    pitchPlayback.reset();
    const latest = [...state.positions.values()].sort((a, b) => a.time - b.time).at(-1);
    if (latest) paint(latest);
    return;
  }
  pitchPlayback.update(state.positions.values());
  const tick = (now) => {
    if (!playing || !followLatest || viewerRefresh.blocked) return;
    const shown = pitchPlayback.step(null, now, { rate: Number($('speed').value), buffer: 0.6 });
    if (shown) {
      paint(shown);
      presentLivePlay(shown.displayTime, shown.players, shown.ballState);
      renderWatchClock(shown.displayTime);
    }
    motionFrame = requestAnimationFrame(tick);
  };
  tick(performance.now());
}
function applyViewerPreferences(profile) {
  appliedViewerProfile = { ...profile };
  $('audience').value = profile.audience;
  $('language').value = profile.language;
  $('club').value = profile.favoriteClub || '';
  if (
    profile.favoritePlayer &&
    ![...$('player').options].some((option) => option.value === profile.favoritePlayer)
  ) {
    const option = document.createElement('option');
    option.value = profile.favoritePlayer;
    option.textContent = `${profile.favoritePlayer} — not in this match`;
    $('player').append(option);
  }
  $('player').value = profile.favoritePlayer || '';
  updateProfileLabel();
}
function updateProfileLabel() {
  preferencesPanel.querySelector('summary').textContent =
    !developerView && !studioView
      ? 'Viewing options'
      : `Personalize your view · ${$('audience').selectedOptions[0].textContent}`;
  if (!developerView && !studioView)
    $('player').closest('label').hidden = $('audience').value !== 'player';
}
function persistViewerPreferences() {
  updateProfileLabel();
  appliedViewerProfile = readPreferenceControls();
  preferencesStatus.textContent = saveViewerPreferences(preferenceStorage(), appliedViewerProfile)
    ? 'Viewing preferences saved on this device.'
    : '';
}
function syncRosterOptions(frame) {
  const players =
    frame?.players?.filter(
      (player) => ['home', 'away'].includes(player.team) && isSafePlayerName(player.name),
    ) || [];
  if (!players.length) return;
  const key = JSON.stringify([
    preferences().kind,
    preferences().seed,
    players.map(({ id, name, team, number }) => [id, name, team, number]),
  ]);
  if (key === rosterOptionsKey) return;
  rosterOptionsKey = key;
  const choice = $('player').value || appliedViewerProfile.favoritePlayer || '',
    names = fixtureTeams(preferences().kind, preferences().seed);
  $('player').innerHTML =
    '<option value="">Choose a player</option>' +
    ['home', 'away']
      .map(
        (team) =>
          `<optgroup label="${escape(names[team])}">${players
            .filter((player) => player.team === team)
            .map(
              (player) =>
                `<option value="${escape(player.name)}">${escape(player.name)} · #${player.number}</option>`,
            )
            .join('')}</optgroup>`,
      )
      .join('');
  if (choice && !players.some((player) => player.name === choice)) {
    const option = document.createElement('option');
    option.value = choice;
    option.textContent = `${choice} — not in this match`;
    $('player').append(option);
  }
  $('player').value = choice;
}
function stop() {
  if (stream) stream.close();
  stream = null;
  playing = false;
  cancelAnimationFrame(motionFrame);
  stopBuildupReplay();
  $('play').textContent = 'Play match';
  if (state.matchId) {
    $('status').textContent = 'Paused at received replay time.';
    $('view-mode').textContent = followLatest ? 'Replay paused' : 'Reading a selected moment';
  }
}
function connect(time, run = false, { preserveMatch = false } = {}) {
  const preserve = preserveMatch && !!state.matchId && time === state.time;
  const latestFrame = [...state.positions.values()].sort((a, b) => a.time - b.time).at(-1);
  refreshFrame = preserve
    ? refreshFrame || (followLatest ? latestFrame : momentScene(selected).frame || latestFrame)
    : null;
  const current = viewerRefresh.begin(preserve);
  generationController?.abort();
  recapExportController?.abort();
  recapError = null;
  $('recap-ai-status').textContent = '';
  studioLoader.reset();
  studioValidatedKey = null;
  studioResult = null;
  stop();
  momentLoader.reset();
  selected = null;
  state = preserve ? preferenceRefreshSnapshot(state) : { ...emptyStream(), time };
  pitchPlayback.reset();
  watchClockKey = null;
  if (preserve) {
    draft = null;
    draftPreferences = null;
    recapDraft = null;
    recapDraftPreferences = null;
    studioPreview = null;
    focusedPlayer = null;
  }
  if (preserve || catchupPreferences !== preferencesKey() || catchupObservedAt > time) {
    updateMarkup($('catchup-result'), '');
    catchupPreferences = null;
    catchupObservedAt = null;
  }
  $('explanation').textContent = preserve
    ? 'Updating your view…'
    : anchor
      ? 'Loading selected moment at the new received replay time…'
      : 'Select a received event to inspect its evidence.';
  $('time').max = fixtureSettings($('kind').value).horizon;
  $('status').hidden = preserve;
  playing = run;
  $('play').textContent = run ? 'Pause match' : 'Play match';
  $('status').textContent = 'Connecting to received evidence…';
  render();
  const query = new URLSearchParams({ ...preferences(), time, speed: $('speed').value });
  let receivedState = { ...emptyStream(), time };
  // Empty selections must be omitted: the API distinguishes null from an unknown club.
  for (const key of ['favoriteClub', 'favoritePlayer']) if (!preferences()[key]) query.delete(key);
  const connection = new EventSource(`/api/stream?${query}`);
  stream = connection;
  connection.addEventListener('match', (event) => {
    if (!viewerRefresh.isCurrent(current)) return;
    try {
      $('status').hidden = true;
      receivedState = applyStream(receivedState, JSON.parse(event.data));
      state = receivedState;
      if (followLatest)
        anchor =
          (!developerView && !studioView
            ? chooseWatchInsight([...state.eventHistory.values()], state.time, {
                language: preferences().language,
              }).anchorId
            : selectLiveStory(state.events.values(), state.time, preferences())?.event.id) || null;
      render();
      inspect();
      $('status').textContent = playing
        ? 'Receiving synthetic replay events.'
        : 'Paused at received replay time.';
      if (!playing) {
        connection.close();
        stream = null;
      }
    } catch (error) {
      connectionFailure(error.message);
    }
  });
  connection.addEventListener('complete', () => {
    if (!viewerRefresh.isCurrent(current)) return;
    stop();
    render();
    $('status').hidden = false;
    $('status').textContent = 'Replay complete, including received updates.';
  });
  function connectionFailure(message) {
    if (!viewerRefresh.isCurrent(current)) return;
    stop();
    momentLoader.reset();
    if (preserve) viewerRefresh.fail(current);
    renderJourney();
    $('status').hidden = false;
    $('status').textContent = message;
    if (preserve) {
      $('explanation').textContent =
        'Your view could not be updated. The last received match positions remain visible. Retry your view to continue.';
      renderAI();
      producerReview.update();
    }
  }
  connection.onerror = () =>
    connectionFailure(
      preserve
        ? 'Could not refresh your view. Your last received score and positions are retained.'
        : 'Stream interrupted. Press play to reconnect from this received time.',
    );
}
function renderJourney() {
  const kind = preferences().kind,
    example = kind === 'sustained',
    complete = state.matchId && state.time >= fixtureSettings(kind).horizon;
  fixtureIdentity.textContent =
    kind === 'extended'
      ? 'Six-minute fictional replay'
      : fixtureSettings(kind).horizon === 120
        ? `${$('kind').selectedOptions[0].textContent} · two-minute fictional example`
        : kind === 'withdrawal'
          ? 'Fictional event withdrawal demo'
          : 'Fictional eight-second sequence';
  if (complete)
    fixtureIdentity.textContent += example ? ' · Example complete' : ' · Replay complete';
  mainFixtureButton.hidden = !developerView || kind === 'extended';
  exampleButton.hidden = !developerView || example;
  $('play').textContent = playing
    ? 'Pause match'
    : viewerRefresh.status === 'failed'
      ? 'Retry your view'
      : complete
        ? example
          ? 'Replay example'
          : 'Replay from start'
        : state.time > 0
          ? 'Resume match'
          : 'Play match';
}
function render() {
  renderMatchBranding();
  renderWatchStats();
  productionDesk?.update();
  renderJourney();
  const complete = state.matchId && state.time >= fixtureSettings(preferences().kind).horizon;
  if (!developerView && !studioView && !complete) recapPanel.hidden = true;
  finishPanel.hidden = !complete || viewerRefresh.blocked;
  finishPanel.querySelector('[data-finish-summary]').textContent = complete ? state.summary : '';
  finishPanel.querySelector('[data-finish-summary]').lang = preferences().language;
  const moments = viewerRefresh.blocked
    ? null
    : viewerMoments(state.events.values(), state.time, preferences());
  const momentContent = momentsPanel.querySelector('div');
  updateMarkup(
    momentContent,
    !moments
      ? '<p>Your moments will return when this view is ready.</p>'
      : moments.total
        ? `${moments.omitted ? `<p class="disclosure">Latest ${moments.moments.length} of ${moments.total} moments. The recap covers the received segment.</p>` : ''}${moments.moments.map((m) => `<button class="moment-link secondary" data-moment-anchor="${escape(m.anchorId)}" aria-pressed="${m.anchorId === anchor}" lang="${preferences().language}"><time>${stamp(m.time)}</time><span>${escape(m.text)}</span></button>`).join('')}`
        : '<p>No key moments have arrived yet.</p>',
  );
  document.querySelector('.intro .notice small').textContent =
    preferences().kind === 'extended'
      ? 'Fictional teams · six-minute demo segment'
      : fixtureSettings(preferences().kind).horizon === 120
        ? 'Fictional teams · two-minute continuous passage'
        : preferences().kind === 'withdrawal'
          ? 'Fictional teams · event withdrawal demo'
          : 'Fictional teams · eight-second demo sequence';
  const latestFrame = [...state.positions.values()].sort((a, b) => a.time - b.time).at(-1);
  syncRosterOptions(latestFrame);
  focusedPlayer =
    !viewerRefresh.blocked && preferences().audience === 'player'
      ? playerFocus(state.eventHistory.values(), state.time, preferences(), latestFrame)
      : null;
  const needsPlayer =
    !viewerRefresh.blocked && preferences().audience === 'player' && !preferences().favoritePlayer;
  playerSpotlight.hidden = !focusedPlayer && !needsPlayer;
  if (needsPlayer)
    updateMarkup(
      playerSpotlight,
      '<p class="focus-label">Choose a player in Viewing options to follow their game.</p><button class="secondary" data-choose-player>Choose a player</button>',
    );
  if (focusedPlayer && !developerView && !studioView) {
    const labels = {
      en: ['Shots', 'Passes made', 'Ball wins'],
      es: ['Tiros', 'Pases completos', 'Recuperaciones'],
      fr: ['Tirs', 'Passes réussies', 'Récupérations'],
      pt: ['Remates', 'Passes completos', 'Recuperações'],
    }[preferences().language];
    const noAction = {
      en: 'No on-ball action yet.',
      es: 'Aún no ha intervenido con el balón.',
      fr: 'Pas encore d’action avec le ballon.',
      pt: 'Ainda não teve uma ação com a bola.',
    }[preferences().language];
    updateMarkup(
      playerSpotlight,
      `<div class="player-follow-heading"><strong>${escape(focusedPlayer.favoritePlayer)}</strong><span>${stamp(focusedPlayer.window.start)}–${stamp(focusedPlayer.window.end)}</span></div><p class="focus-label">${escape(focusedPlayer.status === 'known' ? focusedPlayer.lastAction?.text || noAction : focusedPlayer.summary)}</p>${focusedPlayer.counts ? `<dl class="player-follow-stats">${[focusedPlayer.counts.shots, focusedPlayer.counts.completedPasses, focusedPlayer.counts.recoveriesUnknown ? '—' : focusedPlayer.counts.recoveries].map((value, index) => `<div><dt>${labels[index]}</dt><dd>${value}</dd></div>`).join('')}</dl>` : ''}`,
    );
  } else if (focusedPlayer) {
    const latestAlreadySelected = focusedPlayer.lastAction?.anchorId === anchor;
    updateMarkup(
      playerSpotlight,
      `<p lang="${preferences().language}" class="focus-label">${escape(latestAlreadySelected ? focusedPlayer.activitySummary || focusedPlayer.summary : focusedPlayer.summary)}</p>${focusedPlayer.lastAction && !latestAlreadySelected ? `<button class="secondary" data-focus-event="${escape(focusedPlayer.lastAction.anchorId)}">View player\'s latest action</button>` : ''}<details><summary>Player evidence</summary><p class="disclosure">${escape(focusedPlayer.limitation)}</p><pre>${escape(focusedPlayer.evidence.map((r) => `${r.type}: ${r.id} / v${r.revision}`).join('\n'))}</pre></details>`,
    );
  }
  $('catchup').disabled = viewerRefresh.blocked || !state.matchId;
  catchupShortcut.disabled = viewerRefresh.blocked || !state.matchId || state.time === 0;
  renderMatchContext();
  producerReview.update();
  $('dataset-download').disabled = !state.matchId || !!datasetController;
  $('clock').textContent = state.matchId ? stamp(state.time) : '—';
  $('time').value = state.time;
  $('score').textContent = state.matchId ? `${state.score.home} : ${state.score.away}` : '— : —';
  replayElapsed.textContent = stamp(state.time);
  replayDuration.textContent =
    stamp(Number($('time').max)) + (!developerView && !studioView ? ' · 2×' : '');
  $('time').setAttribute(
    'aria-valuetext',
    `${stamp(state.time)} of ${stamp(Number($('time').max))}${!developerView && !studioView ? ' · 2× replay' : ''}`,
  );
  $('score').setAttribute(
    'aria-label',
    state.matchId
      ? `Current replay score: ${fixtureTeams(preferences().kind, preferences().seed).home} ${state.score.home}, ${fixtureTeams(preferences().kind, preferences().seed).away} ${state.score.away}`
      : 'Loading the current replay score',
  );
  const events = [...state.events.values()].sort(
    (a, b) => b.time - a.time || a.id.localeCompare(b.id),
  );
  updateMarkup(
    $('feed'),
    events.length
      ? events
          .map(
            (e) =>
              `<div class="event ${escape(e.team)}"><time>${stamp(e.time)}</time><div><strong>${escape(e.player)} · ${escape(e.type)}${e.type === 'shot' && e.result ? ' · GOAL' : ''}</strong><small>${escape(e.id)} / v${e.revision} · received ${stamp(e.arrivedAt)}</small><button class="secondary event-explain" data-unified-event="${escape(e.id)}" aria-pressed="${e.id === anchor}">Inspect moment</button></div></div>`,
          )
          .join('')
      : '<p class="disclosure">No events received yet.</p>',
  );
  renderPitch();
  watchClockKey = null;
  renderWatchClock(playing && pitchPlayback.time !== null ? pitchPlayback.time : state.time);
  if (followLatest && document.activeElement === $('current'))
    $('play').focus({ preventScroll: true });
  $('current').hidden = followLatest;
  $('current').textContent = playing ? 'Follow current play' : 'Return to current moment';
  $('view-mode').textContent = state.matchId
    ? followLatest
      ? playing
        ? 'Following play'
        : 'Replay paused'
      : 'Reading a selected moment'
    : 'Connecting to the replay...';
  // One story appears in the side panel; avoid repeating it beneath the pitch.
  $('overlays').replaceChildren();
  $('summary').textContent = viewerRefresh.blocked
    ? 'Your recap will return when this view is ready.'
    : state.summary;
  updateMarkup(
    $('recap'),
    viewerRefresh.blocked
      ? ''
      : [...state.recap.values()]
          .sort((a, b) => a.time - b.time)
          .map(
            (e) =>
              `<p><b>${stamp(e.time)}</b> · ${escape(e.text)} <button class="secondary event-explain" data-unified-event="${escape(e.anchorId)}">${!developerView && !studioView ? 'View moment' : 'Inspect recap evidence'}</button></p>`,
          )
          .join(''),
  );
  if (
    !developerView &&
    state.matchId &&
    !viewerRefresh.blocked &&
    (selected || (!studioView && followLatest))
  )
    presentFanMoment(state.time === 0 && !playing && followLatest);
  renderAI();
}
function renderPitch() {
  stopBuildupReplay();
  const livePitch = playing && followLatest && !viewerRefresh.blocked;
  const sceneAnchor = viewerRefresh.blocked || followLatest ? null : anchor;
  const scene = momentScene(selected?.anchorId === sceneAnchor ? selected : null),
    latest = [...state.positions.values()].sort((a, b) => a.time - b.time).at(-1);
  const frame = viewerRefresh.blocked ? refreshFrame || latest : sceneAnchor ? scene.frame : latest,
    layer = $('positions');
  const focusId = focusedPlayer?.status === 'known' ? focusedPlayer.playerId : null;
  const storyEvent = state.events.get(anchor);
  const storyPlayerId =
    !sceneAnchor && !viewerRefresh.blocked && (developerView || studioView)
      ? storyEvent?.playerId
      : null;
  const paintKey =
    livePitch && frame
      ? JSON.stringify([
          frame.players.map((p) => [p.id, p.team, p.number, p.name]),
          focusId,
          storyPlayerId,
        ])
      : null;
  const reusePaint = paintKey !== null && paintKey === livePaintKey && livePaint;
  if (!reusePaint) {
    layer.replaceChildren();
    livePaint = null;
    livePaintKey = null;
  }
  if (focusId) scene.names[focusId] = preferences().favoritePlayer;
  const svg = (tag, attrs) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    layer.append(el);
    return el;
  };
  const links =
    frame && selected?.anchorId === sceneAnchor
      ? recordedMomentPath(selected, {
          observedAt: state.time,
          currentEvents: state.events.values(),
          currentFrames: latestReceivedPositions(),
        })
      : [];
  for (const link of links) {
    const color = link.kind === 'pass-endpoint-link' ? '#91d9ef' : '#f4ce82';
    const line = svg('line', {
      x1: link.start.x * 10,
      y1: link.start.y * 10,
      x2: link.end.x * 10,
      y2: link.end.y * 10,
      stroke: color,
      'stroke-width': 5,
      'stroke-dasharray': '9 7',
      opacity: 0.9,
    });
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = link.description;
    line.append(title);
    svg('circle', { cx: link.start.x * 10, cy: link.start.y * 10, r: 8, fill: color });
    svg('circle', {
      cx: link.end.x * 10,
      cy: link.end.y * 10,
      r: 12,
      fill: 'none',
      stroke: color,
      'stroke-width': 4,
    });
  }
  const pathCopy = {
    en: {
      pass: 'pass',
      shot: 'shot',
      lead: 'Ball positions',
      limit: 'Links show sampled positions, not the ball’s path.',
    },
    es: {
      pass: 'pase',
      shot: 'tiro',
      lead: 'Posiciones del balón',
      limit: 'Los enlaces muestran posiciones muestreadas, no la trayectoria del balón.',
    },
    fr: {
      pass: 'passe',
      shot: 'tir',
      lead: 'Positions du ballon',
      limit: 'Les liens montrent les positions échantillonnées, pas la trajectoire du ballon.',
    },
    pt: {
      pass: 'passe',
      shot: 'remate',
      lead: 'Posições da bola',
      limit: 'As ligações mostram posições amostradas, não a trajetória da bola.',
    },
  }[preferences().language];
  pathCaption.hidden = !links.length;
  pathCaption.textContent = links.length
    ? `${pathCopy.lead}: ${links.map((link) => `${pathCopy[link.kind === 'pass-endpoint-link' ? 'pass' : 'shot']} ${stamp(link.start.time)}–${stamp(link.end.time)}`).join(' · ')}. ${pathCopy.limit}`
    : '';
  const paint =
    reusePaint ||
    (frame
      ? drawPitchPlayers(layer, frame, {
          tracker: !developerView && !studioView,
          selected: !!sceneAnchor,
          participants: scene.participants,
          names: scene.names,
          focusId,
          storyPlayerId,
        })
      : null);
  visiblePaint = paint;
  if (livePitch && paint) {
    livePaint = paint;
    livePaintKey = paintKey;
  }
  $('scene-caption').textContent =
    viewerRefresh.blocked && frame
      ? `Recorded positions at ${stamp(frame.time)}: ${viewerRefresh.status === 'failed' ? 'view refresh unavailable' : 'updating your view'}`
      : sceneAnchor
        ? frame
          ? `Selected moment ${stamp(frame.time)} · ${focusId && !scene.participants.includes(focusId) ? 'buildup participants named; your followed player is outlined' : 'named players took part in the recorded buildup'}`
          : 'Loading the selected moment. No estimated positions are shown.'
        : frame
          ? `${frame.phase === 'reset' ? 'Scripted scene transition' : 'Current replay positions'} · ${stamp(frame.time)}`
          : 'Waiting for match positions.';
  if (livePitch && frame) {
    animatePitch(paint);
    $('scene-caption').textContent =
      `Current play · ${stamp(frame.time)}${storyEvent ? ` · Story: ${storyEvent.player || 'team action'} at ${stamp(storyEvent.time)} · green ring` : ''}`;
  } else {
    cancelAnimationFrame(motionFrame);
    pitchPlayback.reset();
  }
  if (frame && !sceneAnchor && !viewerRefresh.blocked)
    $('scene-caption').textContent =
      `${livePitch ? 'Current play' : 'Paused play'} · ${stamp(frame.time)}${storyEvent ? ` · Story: ${storyEvent.player || 'team action'} at ${stamp(storyEvent.time)} · green ring` : ''}`;
  $('pitch').setAttribute(
    'aria-label',
    sceneAnchor
      ? frame
        ? `Recorded player positions at ${stamp(frame.time)} for the selected moment. Named players: ${Object.values(scene.names).join(', ')}.${focusId ? ' Your followed player has a green outline.' : ''}`
        : 'Selected moment positions unavailable.'
      : livePitch
        ? 'Synthetic replay animation between received position samples. Animated positions are not evidence measurements.'
        : 'Current received synthetic player positions.',
  );
  if (links.length)
    $('pitch').setAttribute(
      'aria-label',
      `${$('pitch').getAttribute('aria-label')} ${pathCaption.textContent}`,
    );
  $('frame').textContent = frame
    ? `Displayed received sample: ${frame.time}s · ${frame.id} / v${frame.revision} · received ${frame.arrivedAt}s.`
    : 'No exact received positional sample is displayed.';
  if (links.length) {
    const refs = new Map(
      links
        .flatMap((link) => link.evidence)
        .map((ref) => [`${ref.type}:${ref.id}@${ref.revision}`, ref]),
    );
    $('frame').textContent +=
      ` Endpoint link evidence: ${[...refs.values()].map((ref) => `${ref.type}: ${ref.id} / v${ref.revision}`).join(' · ')}.`;
  }
}
function renderMatchContext() {
  if (!state.matchId) {
    changePanel.hidden = true;
    picturePanel.lastElementChild.textContent = 'Waiting for received match events.';
    return;
  }
  const records = [...state.eventHistory.values()],
    language = preferences().language;
  const picture = matchPicture(records, state.time, {
      language,
      teams: fixtureTeams(preferences().kind, preferences().seed),
    }),
    labels = picture.labels;
  picturePanel.querySelector('summary').textContent = labels.title;
  const rows = ['shots', 'onTarget', 'completedPasses', 'passAccuracy', 'recoveries'];
  const value = (team, key) => {
    const cell = team.cells[key];
    return cell.value === null
      ? '—'
      : key === 'passAccuracy'
        ? `${cell.value.toFixed(0)}%`
        : String(cell.value);
  };
  const pending = picture.teams
    .filter((team) => team.cells.completedPasses.pendingCount)
    .map(
      (team) =>
        `${team.name}: ${team.cells.completedPasses.pendingCount} ${labels.pending.toLowerCase()}`,
    );
  const unknown = picture.teams
    .filter((team) => team.cells.onTarget.unknownCount)
    .map(
      (team) => `${team.name}: ${team.cells.onTarget.unknownCount} ${labels.unknown.toLowerCase()}`,
    );
  updateMarkup(
    picturePanel.lastElementChild,
    `<p lang="${language}" class="disclosure">${escape(labels.scope)} · 00:00–${stamp(state.time)}</p><table lang="${language}"><caption class="sr-only">${escape(labels.title)}</caption><thead><tr><th scope="col">${escape(labels.team)}</th>${picture.teams.map((team) => `<th scope="col">${escape(team.name)}</th>`).join('')}</tr></thead><tbody>${rows.map((key) => `<tr><th scope="row">${escape(labels[key])}</th>${picture.teams.map((team) => `<td>${escape(value(team, key))}</td>`).join('')}</tr>`).join('')}</tbody></table>${pending.length || unknown.length ? `<p lang="${language}" class="disclosure">${escape([...pending, ...unknown].join(' · '))}</p>` : ''}<details><summary>Comparison evidence and definitions</summary><p lang="${language}" class="disclosure">${escape(picture.limitation)}</p><pre>${escape(JSON.stringify(picture.teams, null, 2))}</pre></details>`,
  );
  const change = matchChange(records, state.time, { language });
  changePanel.hidden = change.status !== 'insight';
  if (!changePanel.hidden)
    updateMarkup(
      changePanel,
      `<p lang="${language}">${escape(change.text)}</p><details><summary>What supports this change?</summary><p lang="${language}" class="disclosure">${escape(change.limitation)}</p><pre>${escape(JSON.stringify({ windows: change.windows, teams: change.teams, evidence: change.evidence }, null, 2))}</pre></details>`,
    );
}
const momentLoader = new InvestigationCache({
  load: async (input, { signal }) => {
    const query = new URLSearchParams(input);
    for (const key of ['favoriteClub', 'favoritePlayer']) if (!input[key]) query.delete(key);
    const response = await fetch(`/api/match?${query}`, { signal });
    if (!response.ok) throw new Error('Could not load this received moment.');
    return response.json();
  },
  apply: (bundle) => {
    selected = bundle.explanation;
    viewerRefresh.finish(viewerRefresh.token);
    refreshFrame = null;
    render();
    presentSelection();
    $('inspection-status').textContent = '';
    $('explanation').removeAttribute('aria-busy');
    renderAI();
  },
  onError: (error) => {
    selected = null;
    if (viewerRefresh.blocked) viewerRefresh.fail(viewerRefresh.token);
    $('explanation').textContent = error.message;
    $('inspection-status').textContent = viewerRefresh.blocked
      ? 'Your view could not be refreshed. Retry your view to continue.'
      : '';
    $('explanation').removeAttribute('aria-busy');
    renderJourney();
    renderPitch();
    renderAI();
  },
});
function presentSelection() {
  const ready = !developerView && state.time === 0 && !playing && followLatest;
  momentPanel.classList.toggle('match-ready', ready);
  if (!developerView) {
    presentFanMoment(ready);
    renderAI();
    return;
  }
  if (ready) {
    updateMarkup(
      $('explanation'),
      '<span class="pill">YOUR MATCH COMPANION</span><h3 class="moment-title">Follow the play.<br>See why it matters.</h3><p class="recorded-summary">Press <strong>Play match</strong> to follow this fictional two-minute passage. Key moments appear here as the action unfolds.</p><p class="welcome-hint">Want a closer look? Choose <strong>Explain this moment</strong> to pause the action and explore the buildup.</p>',
    );
    return;
  }
  const story = [...state.recap.values()].find((e) => e.anchorId === anchor),
    moment = selected?.sequence.find((e) => e.id === anchor);
  const context = selected?.patterns;
  const analystLabels = {
    en: ['Recorded context', 'shots', 'completed passes'],
    es: ['Contexto registrado', 'tiros', 'pases completados'],
    fr: ['Contexte enregistré', 'tirs', 'passes réussies'],
    pt: ['Contexto registado', 'remates', 'passes completos'],
  }[preferences().language];
  const contextRow =
    context && preferences().audience === 'analyst'
      ? `<p class="disclosure" lang="${preferences().language}">${analystLabels[0]} · ${stamp(context.window.start)}–${stamp(context.window.end)}<br>${Object.entries(
          fixtureTeams(preferences().kind, preferences().seed),
        )
          .map(
            ([team, name]) =>
              `${escape(name)}: ${context.teams[team].shots} ${analystLabels[1]} · ${context.teams[team].completedPasses} ${analystLabels[2]}`,
          )
          .join('<br>')}</p>`
      : '';
  const contextTable =
    context && preferences().audience === 'analyst'
      ? `<div class="pattern-context"><p>Recorded context · ${stamp(context.window.start)}–${stamp(context.window.end)}</p><table><caption class="sr-only">Received event counts before the selected moment</caption><thead><tr><th scope="col">Club</th><th scope="col">Shots</th><th scope="col">Completed passes</th><th scope="col">Recoveries</th></tr></thead><tbody>${Object.entries(
          fixtureTeams(preferences().kind, preferences().seed),
        )
          .map(
            ([team, name]) =>
              `<tr><th scope="row">${escape(name)}</th><td>${context.teams[team].shots}</td><td>${context.teams[team].completedPasses}</td><td>${context.teams[team].recoveries}</td></tr>`,
          )
          .join(
            '',
          )}</tbody></table><p class="disclosure">${escape(context.limit)}</p><pre>${escape(context.evidence.map((r) => `${r.type}: ${r.id} / v${r.revision}`).join('\n'))}</pre></div>`
      : '';
  updateMarkup(
    $('explanation'),
    selected
      ? `<span class="pill">${stamp(moment.time)} · RECORDED MOMENT</span><h3 lang="${preferences().language}" class="moment-title">${escape(momentHeadline(moment, preferences().language))}</h3><p lang="${preferences().language}" class="recorded-summary">${escape(story?.text || momentSummary(selected, preferences().language, preferences().audience))}</p><details><summary>Match detail and evidence</summary>${contextRow}<p class="disclosure">${escape(selected.limit)}</p><ul>${selected.metrics.map((m) => `<li>${escape(m.kind)}: ${m.value.toFixed(2)} ${escape(m.unit)}${m.interval ? ` · sampled interval ${m.interval.start}–${m.interval.end}s` : ''}</li>`).join('')}</ul>${contextTable}<pre>${escape(selected.evidence.map((e) => `${e.type}: ${e.id} / v${e.revision}`).join('\n'))}</pre></details>`
      : 'This event has not arrived at the current replay time.',
  );
}
function inspect() {
  if (!anchor) {
    momentLoader.reset();
    selected = null;
    viewerRefresh.finish(viewerRefresh.token);
    refreshFrame = null;
    $('inspection-status').textContent = '';
    $('explanation').removeAttribute('aria-busy');
    const message = state.events.size
      ? 'The match is unfolding. Your next key moment will appear here.'
      : 'Play the match to discover a moment worth explaining.';
    if (developerView) $('explanation').textContent = message;
    else if (state.time === 0 && !playing) presentFanMoment(true);
    else updateFanCard({ state: 'live', title: 'Following the play', summary: message });
    render();
    return;
  }
  const moment = state.events.get(anchor);
  const dependencies = [...state.events.values()]
    .filter((e) => e.time <= moment?.time && (e.time >= moment.time - 120 || e.type === 'shot'))
    .map((e) => `${e.id}@${e.revision}`);
  const frames = [...state.positions.values()]
    .filter((f) => f.time <= moment?.time && f.time >= moment.time - 8)
    .map((f) => `${f.id}@${f.revision}`);
  const key = JSON.stringify([preferences(), anchor, dependencies, frames]);
  if (momentLoader.pending?.key === key || momentLoader.completed?.key === key) {
    if (selected) presentSelection();
    renderPitch();
    renderAI();
    return;
  }
  if (developerView) {
    if (selected?.anchorId !== anchor)
      $('explanation').textContent = viewerRefresh.blocked
        ? 'Updating your view…'
        : 'Loading the recorded moment and its evidence...';
  } else
    updateFanCard({
      id: anchor,
      state: 'loading',
      title: momentHeadline(moment, preferences().language),
      timeLabel: stamp(moment.time),
      language: preferences().language,
    });
  selected = null;
  $('inspection-status').textContent = viewerRefresh.blocked
    ? 'Applying your viewing preferences…'
    : 'Updating received evidence...';
  $('explanation').setAttribute('aria-busy', 'true');
  renderPitch();
  renderAI();
  momentLoader.request(key, { ...preferences(), time: state.time, anchorId: anchor });
}
function currentStudioCue() {
  return buildStoryCue(draft, selected, {
    preferencesMatch: preferencesKey() === draftPreferences,
    observedAt: state.time,
    eventTime: selected?.sequence.find((e) => e.id === selected.anchorId)?.time,
    language: preferences().language,
    audience: preferences().audience,
    factCatalog: { facts: draft?.selectedFacts },
    receivedReferences: [...state.events.values()]
      .map((e) => ({ type: 'event', id: e.id, revision: e.revision }))
      .concat(selected?.evidence || [], selected?.patterns?.evidence || []),
  });
}
function studioLatestEvents() {
  const latest = new Map(state.events);
  for (const event of state.eventHistory.values())
    if (!latest.has(event.id) || latest.get(event.id).revision < event.revision)
      latest.set(event.id, event);
  return [...latest.values()];
}
function studioRequestKey() {
  return JSON.stringify([
    studioPreview?.cue,
    preferences(),
    state.time,
    studioLatestEvents().map((e) => [e.id, e.revision, e.operation]),
    [...state.positions.values()].map((f) => [f.id, f.revision]),
  ]);
}
const studioLoader = new InvestigationCache({
  load: async (input, { signal }) => {
    const { withdrawalRecords, ...query } = input,
      bundle = await momentLoader.load(query, { signal });
    // This independent server snapshot recomputes metric revisions for the cue's
    // own anchor, even when the viewer follows a different selected moment.
    const events = new Map(bundle.state.events.map((e) => [e.id, e]));
    for (const event of [...(bundle.state.updates || []), ...(withdrawalRecords || [])])
      if (!events.has(event.id) || events.get(event.id).revision < event.revision)
        events.set(event.id, event);
    return studioPreviewState(studioPreview, {
      time: input.time,
      preferences: query,
      evidenceKey: bundle.explanation?.investigationKey,
      receivedReferences: [...events.values()]
        .map((e) => ({
          type: 'event',
          id: e.id,
          revision: e.revision,
          time: e.time,
          arrivedAt: e.arrivedAt,
          operation: e.operation,
        }))
        .concat(bundle.explanation?.evidence || [], bundle.explanation?.patterns?.evidence || []),
    });
  },
  apply: (result, { key }) => {
    studioResult = result;
    studioValidatedKey = key;
    renderStudioPreview();
  },
  onError: () => {
    studioResult = { status: 'invalid', reason: 'current-evidence-unavailable', claims: [] };
    studioValidatedKey = studioRequestKey();
    renderStudioPreview();
  },
});
function studioPreviewMarkup(result) {
  return `${result.status === 'visible' ? result.claims.map((c) => `<p>${escape(c.text)}</p>`).join('') : ''}<p class="disclosure">${result.timing ? `Event ${stamp(result.timing.anchorEventTime)} · display ends ${stamp(result.timing.effectiveExpiresAt)}. ` : ''}Local synthetic preview; no publishing or new AI call.</p><details><summary>Preview timing and evidence</summary><p class="disclosure">${escape(result.reason)}</p><pre>${escape(JSON.stringify({ timing: result.timing, evidence: studioPreview.cue.evidence }, null, 2))}</pre></details>`;
}
function renderStudioPreview() {
  const current =
    selected &&
    draft?.status === 'draft' &&
    draft.authorship?.wording === 'application-fact-templates' &&
    [selected.key, selected.investigationKey].includes(draft.key) &&
    selected.anchorId === draft.anchorId &&
    preferencesKey() === draftPreferences;
  $('studio-preview').disabled = !current;
  $('studio-clear').disabled = !studioPreview;
  if (!studioPreview) {
    $('studio-status').textContent = 'Choose an existing AI-selected moment story to preview.';
    updateMarkup($('studio-result'), '');
    return;
  }
  const eligibility = studioPreviewState(studioPreview, {
    time: state.time,
    preferences: preferences(),
    receivedReferences: [],
  });
  if (
    eligibility.status === 'expired' ||
    eligibility.status === 'invalid' ||
    eligibility.reason === 'preferences-changed'
  ) {
    studioLoader.reset();
    studioValidatedKey = null;
    studioResult = eligibility;
  } else if (!state.matchId) {
    $('studio-status').textContent =
      'Waiting for current received evidence. Preview text is hidden.';
    updateMarkup(
      $('studio-result'),
      studioPreviewMarkup({
        status: 'checking',
        reason: 'Cue evidence below is awaiting current validation; no claims are displayed.',
      }),
    );
    return;
  } else {
    const key = studioRequestKey();
    if (studioValidatedKey !== key) {
      $('studio-status').textContent =
        'Checking current received evidence. Preview text is hidden.';
      updateMarkup(
        $('studio-result'),
        studioPreviewMarkup({
          status: 'checking',
          reason: 'Cue evidence below is awaiting current validation; no claims are displayed.',
        }),
      );
      studioLoader.request(key, {
        ...preferences(),
        time: state.time,
        anchorId: studioPreview.cue.anchorId,
        withdrawalRecords: studioLatestEvents().filter((e) => e.operation === 'delete'),
      });
      return;
    }
  }
  const result = studioResult;
  $('studio-status').textContent =
    result.status === 'visible'
      ? 'Local cue visible. Human review required.'
      : result.status === 'expired'
        ? 'Cue expired: the event display window has ended.'
        : result.status === 'superseded'
          ? 'Cue withdrawn: its evidence or preferences changed.'
          : 'Preview unavailable: current evidence could not be validated.';
  updateMarkup($('studio-result'), studioPreviewMarkup(result));
}
function renderAI() {
  matchChat?.update();
  producerReview.update();
  const replayAction = fanCard?.element.querySelector('.fan-moment-card__watch');
  if (replayAction) replayAction.disabled = busy || viewerRefresh.blocked || !selected;
  if (viewerRefresh.blocked) {
    for (const id of ['draft', 'agent', 'recap-draft', 'studio-preview', 'studio-clear'])
      $(id).disabled = true;
    for (const id of ['ai-result', 'recap-ai-result', 'studio-result']) updateMarkup($(id), '');
    $('ai-status').textContent =
      viewerRefresh.status === 'failed'
        ? 'Explanation unavailable until your view is refreshed.'
        : 'Explanation will be available when your view is ready.';
    return;
  }
  renderStudioPreview();
  renderRecapAI();
  if (
    !busy &&
    [
      'Explanation unavailable until your view is refreshed.',
      'Explanation will be available when your view is ready.',
    ].includes($('ai-status').textContent)
  )
    $('ai-status').textContent = aiAvailabilityMessage;
  $('draft').disabled = busy ? generationTask === 'recap' : !configured || !selected;
  $('draft').hidden = !developerView && !studioView && (!configured || !selected) && !busy;
  $('draft').textContent =
    busy && generationTask !== 'recap' ? 'Cancel explanation' : 'Explain this moment';
  $('agent').disabled = !configured || busy || !selected;
  const recordedSummary = $('explanation').querySelector('.recorded-summary');
  if (recordedSummary) recordedSummary.hidden = !recordedSummary.textContent.trim();
  const meaningBlock = fanCard?.element.querySelector('.fan-moment-card__meaning');
  if (meaningBlock)
    meaningBlock.hidden = !meaningBlock.querySelector('.fan-moment-card__why').textContent.trim();
  if (!draft) {
    updateMarkup($('ai-result'), '');
    return;
  }
  const current =
    selected &&
    [selected.key, selected.investigationKey].includes(draft.key) &&
    selected.anchorId === draft.anchorId &&
    preferencesKey() === draftPreferences;
  const trace = draft.trace || draft.execution?.trace;
  const templated = draft.authorship?.wording === 'application-fact-templates';
  const fanView = !developerView && !studioView;
  if (recordedSummary)
    recordedSummary.hidden =
      !recordedSummary.textContent.trim() ||
      !!(!fanView && current && templated && draft.status === 'draft');
  if (meaningBlock)
    meaningBlock.hidden =
      !meaningBlock.querySelector('.fan-moment-card__why').textContent.trim() ||
      !!(
        !fanView &&
        current &&
        templated &&
        draft.status === 'draft' &&
        draft.selectedFacts?.some((f) => f.kind === 'goal-score-change')
      );
  const visibleClaims = fanView
    ? additionalFanClaims(draft, {
        current,
        hasScoreMeaning: !!meaningBlock && !meaningBlock.hidden,
      })
    : draft.claims;
  let reviewCopy = templated
    ? draft.authorship.mandatoryFacts === 'application-domain-rules'
      ? 'Application rules require the moment and any supported goal consequence. AI selects additional context; evidence templates supply wording. Review before broadcast.'
      : 'AI chose these facts. Evidence templates supplied the wording. Review before broadcast.'
    : draft.review;
  if (templated && draft.status === 'draft') reviewCopy = '';
  if (templated && draft.requirements?.ambiguity)
    reviewCopy = 'The score change could not be confirmed for this moment.';
  const label = !current
    ? 'EXPLANATION OUT OF DATE'
    : draft.status === 'withheld'
      ? 'EXPLANATION UNAVAILABLE'
      : templated
        ? fanView
          ? 'AI CONTEXT'
          : 'AI EXPLANATION'
        : 'AI DRAFT · REVIEW REQUIRED';
  updateMarkup(
    $('ai-result'),
    `<span class="pill">${label}</span>${!current || reviewCopy ? `<p class="disclosure">${current ? escape(reviewCopy) : 'The match information or your preferences changed. Request a new explanation.'}</p>` : ''}${current ? visibleClaims.map((c) => `<p>${escape(c.text)}</p>`).join('') : ''}${fanView && current && templated && draft.status === 'draft' && !visibleClaims.length ? '<p class="disclosure">The AI selection adds no further facts to this card. You can inspect its full selection and sources below.</p>' : ''}<details><summary>AI evidence and execution</summary>${current && templated && draft.status === 'draft' ? '<button class="secondary" data-studio-cue>Download studio cue (JSON)</button><p class="disclosure">Replay timing and citations for review; no broadcast publishing.</p>' : ''}<p class="disclosure">${escape(draft.review)}</p>${draft.limitation ? `<p class="disclosure">${escape(draft.limitation)}</p>` : ''}${draft.claims.map((c) => `<p>${escape(c.text)}<small>${c.evidence.map((r) => `${escape(r.id)} / v${r.revision}`).join(' · ')}</small></p>`).join('')}${draft.execution ? `<p class="disclosure">${draft.execution.modelCalls} model calls · ${draft.execution.toolCalls || 0} tool calls · ${(draft.execution.elapsedMs / 1000).toFixed(1)}s${usageCopy(draft.execution)}</p>` : ''}${trace ? `<pre>${escape(JSON.stringify(trace, null, 2))}</pre>` : ''}</details>`,
  );
}
async function generate(agent = false, factStory = false) {
  if (viewerRefresh.blocked || !selected || busy) return;
  followLatest = false;
  stop();
  renderPitch();
  presentSelection();
  const input = {
    ...preferences(),
    source: 'integrated-match',
    time: state.time,
    anchorId: selected.anchorId,
  };
  const capturedPreferences = preferencesKey(),
    capturedEpoch = viewerRefresh.token;
  busy = true;
  generationTask = 'moment';
  generationController = new AbortController();
  $('ai-status').after(generationElapsed);
  $('ai-status').textContent =
    `${factStory ? 'Preparing explanation' : agent ? 'Investigating' : 'Preparing explanation'}…${provider === 'local' ? ' Local generation can take up to 3 minutes.' : ''}`;
  generationElapsed.hidden = false;
  const started = performance.now(),
    progress = () => {
      generationElapsed.textContent = `${Math.floor((performance.now() - started) / 1000)}s elapsed`;
    };
  progress();
  generationTimer = setInterval(progress, 1000);
  renderAI();
  try {
    const response = await fetch(
      factStory ? '/api/agent/story' : agent ? '/api/agent/investigate' : '/api/ai/explain',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: generationController.signal,
      },
    );
    const result = await response.json();
    if (!response.ok) {
      if ([401, 429, 503].includes(response.status)) await refreshAIStatus();
      throw new Error(result.error || 'Generation failed.');
    }
    generationController.signal.throwIfAborted();
    if (!viewerRefresh.isCurrent(capturedEpoch) || capturedPreferences !== preferencesKey()) return;
    draft = result;
    draftPreferences = capturedPreferences;
    $('ai-status').textContent =
      result.status === 'withheld'
        ? 'AI story withheld. The recorded insight remains available.'
        : 'Explanation ready. Evidence is available below.';
  } catch (error) {
    if (viewerRefresh.isCurrent(capturedEpoch))
      $('ai-status').textContent =
        error.name === 'AbortError'
          ? 'Explanation cancelled. Your recorded insights are still available.'
          : !developerView && /timed out|could not reach Azure/.test(error.message)
            ? 'The AI explanation took too long. Your match insight and replay are still available. Try again later.'
            : error.message;
  } finally {
    clearInterval(generationTimer);
    generationTimer = null;
    generationElapsed.hidden = true;
    generationController = null;
    generationTask = null;
    busy = false;
    renderAI();
    await refreshAIStatus({ preserveStatus: true });
  }
}
function recapReceivedKey() {
  return recapViewKey(state.events.values(), state.time, preferences());
}
function renderRecapAI() {
  if (viewerRefresh.blocked) {
    $('recap-draft').disabled = true;
    updateMarkup($('recap-ai-result'), '');
    return;
  }
  $('recap-draft').disabled = busy ? generationTask !== 'recap' : !configured || !state.events.size;
  $('recap-draft').textContent =
    busy && generationTask === 'recap' ? 'Cancel AI recap' : 'Create AI recap';
  const current =
    recapDraftPreferences === preferencesKey() &&
    currentRecap(recapDraft, {
      records: state.events.values(),
      time: state.time,
      preferences: preferences(),
      requestKey: recapDraftReceivedKey,
    });
  const accepted = current && recapDraft.status === 'draft';
  if (
    accepted &&
    ($('recap').contains(document.activeElement) || $('summary').contains(document.activeElement))
  )
    $('recap-draft').focus({ preventScroll: true });
  $('summary').hidden = !!accepted;
  $('recap').hidden = !!accepted;
  if (!recapDraft) {
    updateMarkup(
      $('recap-ai-result'),
      recapError
        ? `<details><summary>Recap request details</summary><p class="disclosure">${escape(recapError)}</p></details>`
        : '',
    );
    return;
  }
  const recapNotice = !current
    ? 'The match information or your preferences changed. The current recap is shown below.'
    : recapDraft.status === 'withheld'
      ? 'An AI recap could not be confirmed. The recorded recap remains available.'
      : null;
  updateMarkup(
    $('recap-ai-result'),
    `<span class="pill">${!current ? 'RECAP OUT OF DATE' : recapDraft.status === 'withheld' ? 'AI RECAP UNAVAILABLE' : 'AI MATCH RECAP'}</span>${recapNotice ? `<p class="disclosure">${escape(recapNotice)}</p>` : ''}${accepted ? recapDraft.claims.map((c) => `<p>${escape(c.text)}</p>`).join('') : ''}<details><summary>AI recap evidence and execution</summary><p class="disclosure">${escape(recapDraft.review)}</p>${recapDraft.issues?.length ? `<p class="disclosure">Selection review: ${escape(recapDraft.issues.join(' '))}</p>` : ''}${recapDraft.reviewSuggestions?.length ? `<p class="disclosure">Unverified editorial suggestions (not validated match claims): ${escape(recapDraft.reviewSuggestions.join(' '))}</p>` : ''}<p class="disclosure">${escape(recapDraft.limitation)}</p>${recapDraft.claims.map((c) => `<p>${escape(c.text)}<small>${c.evidence.map((r) => `${escape(r.id)} / v${r.revision}`).join(' · ')}</small></p>`).join('')}<p class="disclosure">${recapDraft.execution.modelCalls} model calls · ${(recapDraft.execution.elapsedMs / 1000).toFixed(1)}s${usageCopy(recapDraft.execution)}</p>${accepted ? `<button class="secondary" data-recap-cue ${busy || recapExportController ? 'disabled' : ''}>${recapExportController ? 'Checking recap evidence...' : 'Download recap rundown'}</button><p class="disclosure">Human review required. Downloading makes no new AI call.</p>` : ''}${recapDraft.trace ? `<pre>${escape(JSON.stringify(recapDraft.trace, null, 2))}</pre>` : ''}</details>`,
  );
}
function recapExportIsCurrent(candidate, key) {
  return (
    !viewerRefresh.blocked &&
    candidate === recapDraft &&
    currentRecap(candidate, {
      records: state.events.values(),
      time: state.time,
      preferences: preferences(),
      requestKey: key,
    }) &&
    candidate.status === 'draft' &&
    !busy
  );
}
function updateFanCard(model) {
  if (!fanCard?.element.isConnected) {
    $('explanation').replaceChildren();
    fanCard = createFanMomentCard($('explanation'));
  }
  fanCard.update(model);
}
function receivedBuildup() {
  return buildMomentReplay(selected, {
    events: state.eventHistory.values(),
    frames: [...state.positionHistory.values(), ...(selected?.positions || [])],
    observedAt: state.time,
  });
}
function latestReceivedPositions() {
  const frames = new Map();
  for (const frame of [...state.positionHistory.values(), ...(selected?.positions || [])])
    if (!frames.has(frame.id) || frames.get(frame.id).revision < frame.revision)
      frames.set(frame.id, frame);
  return frames.values();
}
let livePlayKey = '',
  livePlayTitle = '';
function presentLivePlay(time, players, ballState) {
  if (developerView || studioView || !followLatest || viewerRefresh.blocked) return;
  const key = [
    state.matchId,
    Math.floor(time),
    state.eventHistory.size,
    preferences().language,
  ].join(':');
  if (
    key === livePlayKey &&
    $('explanation').querySelector('.fan-moment-card[data-state=live] .moment-title')
      ?.textContent === livePlayTitle
  )
    return;
  livePlayKey = key;
  const latest = [...state.positions.values()].at(-1);
  const frame = players || latest?.players || [];
  const action = livePlayHeadline(state.eventHistory.values(), time, {
    language: preferences().language,
    players: frame,
    ballState: ballState || latest?.ballState,
  });
  if (action) {
    const insight = watchExplanation(state.eventHistory.values(), time, {
      language: preferences().language,
      playbackRate: Number($('speed').value),
    });
    livePlayTitle = action.title;
    updateFanCard({
      state: 'live',
      title: action.title,
      summary: insight?.text || '',
      timeLabel: stamp(action.time),
      language: preferences().language,
    });
  }
}
function presentFanMoment(ready = false) {
  if (!ready && !developerView && !studioView && followLatest) {
    presentLivePlay(state.time);
    return;
  }

  momentPanel.classList.toggle('match-ready', ready);
  if (ready) {
    updateFanCard({
      state: 'ready',
      title: 'Follow the play. See why it matters.',
      summary: 'Follow every pass, shot and save as play unfolds.',
      detail: {
        title: 'How to follow the match',
        text: 'Choose Watch buildup to replay the lead-up to a moment, or Explain this moment for an AI explanation. Personalize your view for your language, club or player.',
      },
    });
    return;
  }
  const moment = selected?.sequence.find((e) => e.id === anchor);
  if (!moment) {
    updateFanCard({ state: 'loading', title: 'Finding the moment…' });
    return;
  }
  const interpretation = momentMeaning([...state.eventHistory.values()], anchor, {
    observedAt: state.time,
    language: preferences().language,
  });
  const clip = receivedBuildup();
  const analyst = preferences().audience === 'analyst';
  const metrics = analyst
    ? selected.metrics.map((m) => `${m.kind}: ${m.value.toFixed(2)} ${m.unit}`)
    : [];
  const metricLabels = {
    en: ['Opponent distance', 'Sampled player speed'],
    es: ['Distancia al rival', 'Velocidad muestreada'],
    fr: ['Distance de l’adversaire', 'Vitesse échantillonnée'],
    pt: ['Distância ao adversário', 'Velocidade amostrada'],
  }[preferences().language];
  const analystMetrics = analyst
    ? ['nearest-opponent', 'player-displacement-rate'].flatMap((kind, index) => {
        const metric = selected.metrics.find((m) => m.kind === kind && Number.isFinite(m.value));
        return metric
          ? [
              {
                label: metricLabels[index],
                value: `${metric.value.toFixed(1)} ${index ? 'm/s' : 'm'}`,
              },
            ]
          : [];
      })
    : [];
  const refs = (interpretation.evidence || selected.evidence).map(
    (e) => `${e.type}: ${e.id} / v${e.revision}`,
  );
  updateFanCard({
    id: anchor,
    title: interpretation.headline || momentHeadline(moment, preferences().language),
    summary:
      interpretation.steps.length > 1 ? '' : interpretation.buildup || interpretation.context || '',
    steps: followLatest ? [] : interpretation.steps,
    why: interpretation.why
      ? `${['took-lead', 'equalized', 'extended-lead', 'reduced-deficit'].includes(interpretation.kind) ? interpretation.title + '. ' : ''}${interpretation.why}`
      : '',
    language: preferences().language,
    state: playing && followLatest ? 'live' : 'selected',
    timeLabel: stamp(moment.time),
    kind: moment.type === 'shot' && moment.result === true ? 'goal' : moment.type,
    detail: { text: selected.limit, items: [...metrics, ...refs] },
    metrics: analystMetrics,
    onWatchBuildup: clip.status === 'available' ? watchBuildup : null,
    replaying: !!buildupReplay && !buildupReplay.done,
    corrected: interpretation.corrected,
    disabled: busy || viewerRefresh.blocked,
  });
}
function stopBuildupReplay() {
  cancelAnimationFrame(buildupAnimation);
  buildupAnimation = 0;
  buildupReplay = null;
}
function watchBuildup() {
  if (busy || viewerRefresh.blocked || !selected) return;
  if (buildupReplay && !buildupReplay.done) {
    stopBuildupReplay();
    renderPitch();
    presentSelection();
    return;
  }
  const clip = receivedBuildup();
  if (clip.status !== 'available') return;
  stop();
  followLatest = false;
  render();
  const scene = momentScene(selected),
    layer = $('positions');
  layer.replaceChildren();
  const paint = drawPitchPlayers(layer, clip.frames[0], {
    selected: true,
    participants: scene.participants,
    names: scene.names,
    focusId: focusedPlayer?.playerId,
  });
  pathCaption.hidden = true;
  buildupReplay = new MomentReplay(clip, performance.now());
  const session = buildupReplay,
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  presentSelection();
  const tick = (wall) => {
    if (buildupReplay !== session) return;
    const pose = session.step(wall);
    paint(reduced ? clip.frames.filter((f) => f.time <= pose.displayTime).at(-1) : pose);
    $('scene-caption').textContent =
      `${session.done ? 'Buildup replay complete' : 'Buildup replay'} · ${stamp(pose.displayTime)} · moment ${stamp(clip.anchorTime)}`;
    $('pitch').setAttribute(
      'aria-label',
      `Received synthetic buildup replay from ${stamp(clip.start)} to ${stamp(clip.end)} for the moment at ${stamp(clip.anchorTime)}. Display animation only.`,
    );
    if (!session.done) buildupAnimation = requestAnimationFrame(tick);
    else {
      buildupAnimation = 0;
      presentSelection();
    }
  };
  tick(performance.now());
}
$('recap-ai-result').onclick = async (event) => {
  if (!event.target.closest('[data-recap-cue]') || recapExportController) return;
  const candidate = recapDraft,
    key = recapDraftReceivedKey;
  if (!recapExportIsCurrent(candidate, key)) return;
  stop();
  const controller = new AbortController();
  recapExportController = controller;
  renderRecapAI();
  try {
    const reviewDraft = Object.fromEntries(
      [
        'status',
        'provider',
        'source',
        'evidenceSource',
        'authorship',
        'language',
        'audience',
        'preferences',
        'scope',
        'observedAt',
        'dependencies',
        'key',
        'selectedFacts',
        'selectedFactIds',
        'claims',
      ].map((name) => [name, candidate[name]]),
    );
    const response = await fetch('/api/studio/recap-cue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draft: reviewDraft,
        time: state.time,
        preferences: preferences(),
        requestKey: key,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = new Error('Recap export could not be validated.');
      error.status = response.status;
      if (response.status === 401) await refreshAIStatus();
      throw error;
    }
    const cue = await response.json();
    controller.signal.throwIfAborted();
    if (!recapExportIsCurrent(candidate, key)) throw new Error('Recap evidence changed.');
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(cue, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `recap-rundown-${cue.scope.fixture.kind}-${cue.scope.fixture.seed}-${cue.scope.observedAt}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('recap-ai-status').textContent = 'Recap rundown downloaded for human review.';
  } catch (error) {
    if (error.name !== 'AbortError' && recapExportIsCurrent(candidate, key))
      $('recap-ai-status').textContent =
        error.status === 401
          ? 'Access expired. Unlock AI access to download this recap.'
          : 'Recap rundown unavailable. Create a current recap and try again.';
  } finally {
    if (recapExportController === controller) {
      recapExportController = null;
      renderRecapAI();
    }
  }
};
async function generateRecap() {
  if (viewerRefresh.blocked || busy || !state.events.size || !configured) return;
  recapExportController?.abort();
  stop();
  followLatest = false;
  const input = { ...preferences(), source: 'integrated-match', time: state.time };
  const capturedPreferences = preferencesKey(),
    capturedReceivedKey = recapReceivedKey();
  recapDraft = null;
  recapDraftPreferences = null;
  recapDraftReceivedKey = null;
  recapError = null;
  busy = true;
  generationTask = 'recap';
  generationController = new AbortController();
  $('recap-ai-status').after(generationElapsed);
  generationElapsed.hidden = false;
  $('recap-ai-status').textContent =
    `Preparing the received segment recap…${provider === 'local' ? ' Local generation can take up to 3 minutes.' : ''}`;
  const started = performance.now(),
    progress = () => {
      generationElapsed.textContent = `${Math.floor((performance.now() - started) / 1000)}s elapsed`;
    };
  progress();
  generationTimer = setInterval(progress, 1000);
  render();
  try {
    const response = await fetch('/api/agent/recap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: generationController.signal,
    });
    const result = await response.json();
    if (!response.ok) {
      if ([401, 429, 503].includes(response.status)) await refreshAIStatus();
      const error = new Error(result.error || 'Recap generation failed.');
      error.status = response.status;
      throw error;
    }
    generationController.signal.throwIfAborted();
    recapDraft = result;
    recapDraftPreferences = capturedPreferences;
    recapDraftReceivedKey = capturedReceivedKey;
    $('recap-ai-status').textContent =
      result.status === 'withheld'
        ? 'AI recap withheld. The recorded recap remains available.'
        : 'Recap ready. Evidence is available below.';
  } catch (error) {
    if (capturedPreferences !== preferencesKey() || capturedReceivedKey !== recapReceivedKey()) {
      recapError = null;
    } else if (error.name === 'AbortError')
      $('recap-ai-status').textContent = 'Recap cancelled. The recorded recap remains available.';
    else {
      recapError = error.message;
      $('recap-ai-status').textContent =
        error.status === 401
          ? 'AI access is locked. Unlock it to create a recap.'
          : error.status === 429
            ? 'AI request limit reached. The recorded recap remains available.'
            : 'AI recap could not be created. The recorded recap remains available.';
    }
  } finally {
    clearInterval(generationTimer);
    generationTimer = null;
    generationElapsed.hidden = true;
    generationController = null;
    generationTask = null;
    busy = false;
    renderAI();
    await refreshAIStatus({ preserveStatus: true });
  }
}
$('dataset-download').onclick = async () => {
  if (!state.matchId || datasetController) return;
  const input = { kind: preferences().kind, seed: preferences().seed, observedAt: state.time },
    controller = new AbortController(),
    wasFocused = document.activeElement === $('dataset-download');
  datasetController = controller;
  $('dataset-download').disabled = true;
  $('dataset-status').textContent =
    `Preparing synthetic records through ${stamp(input.observedAt)}…`;
  try {
    const response = await fetch(`/api/data/synthetic?${new URLSearchParams(input)}`, {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('Dataset unavailable.');
    const dataset = await response.json();
    controller.signal.throwIfAborted();
    if (
      dataset.schema !== 'infinite-stadium.synthetic-dataset.v1' ||
      dataset.synthetic !== true ||
      dataset.observedAt !== input.observedAt ||
      dataset.fixture?.kind !== input.kind ||
      dataset.fixture?.seed !== input.seed
    )
      throw new Error('Invalid dataset.');
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(dataset, null, 2)], { type: 'application/json' }),
      ),
      link = document.createElement('a');
    link.href = url;
    link.download = `synthetic-${input.kind}-${input.seed}-received-${input.observedAt}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('dataset-status').textContent =
      `Synthetic ${input.kind} dataset downloaded through ${stamp(input.observedAt)}. No model call.`;
  } catch (error) {
    if (error.name !== 'AbortError')
      $('dataset-status').textContent =
        'Dataset download unavailable. Try again from the received replay.';
  } finally {
    if (datasetController === controller) {
      datasetController = null;
      $('dataset-download').disabled = !state.matchId;
      if (wasFocused && !$('dataset-download').disabled && document.activeElement === document.body)
        $('dataset-download').focus({ preventScroll: true });
    }
  }
};
$('recap-draft').onclick = () => {
  if (busy && generationTask === 'recap') generationController?.abort();
  else generateRecap();
};
$('play').onclick = () => {
  if (playing) {
    if (viewerRefresh.blocked) playing = false;
    else stop();
    render();
    $('status').textContent = 'Paused at received replay time.';
  } else if (viewerRefresh.status === 'failed') {
    connect(state.time, false, { preserveMatch: true });
  } else {
    followLatest = true;
    connect(state.time >= Number($('time').max) ? 0 : state.time, true, { preserveMatch: true });
  }
};
$('reset').onclick = () => {
  anchor = null;
  followLatest = true;
  connect(0);
};
$('current').onclick = () => {
  followLatest = true;
  connect(state.time, playing);
};
$('time').oninput = () => {
  anchor = null;
  followLatest = true;
  connect(Number($('time').value));
};
$('kind').onchange = () => {
  anchor = null;
  followLatest = true;
  connect(0);
};
for (const id of ['audience', 'language', 'club', 'player'])
  $(id).onchange = () => {
    if (!developerView && !studioView) {
      if (id === 'language') {
        // A visible language selection is effective immediately. Keep other
        // draft viewing choices separate until the viewer applies them.
        appliedViewerProfile = { ...appliedViewerProfile, language: $('language').value };
        saveViewerPreferences(preferenceStorage(), appliedViewerProfile);
        preferencesStatus.textContent = 'Language updated for new answers, insights and recaps.';
        connect(state.time, playing, { preserveMatch: true });
        return;
      }
      updateProfileLabel();
      preferencesStatus.textContent = 'Apply your changes when ready.';
      return;
    }
    persistViewerPreferences();
    connect(state.time, playing, { preserveMatch: true });
  };
applyPreferences.onclick = () => {
  persistViewerPreferences();
  preferencesPanel.open = false;
  connect(state.time, playing, { preserveMatch: true });
  preferencesPanel.querySelector('summary').focus({ preventScroll: true });
};
$('speed').onchange = () => connect(state.time, playing, { preserveMatch: true });
resetPreferences.onclick = () => {
  const cleared = clearViewerPreferences(preferenceStorage());
  applyViewerPreferences(defaultViewerPreferences());
  preferencesStatus.textContent = cleared
    ? 'Viewing preferences reset.'
    : 'Preferences reset for this visit. Saved preferences could not be removed.';
  connect(state.time, playing, { preserveMatch: true });
};
for (const id of ['feed', 'recap'])
  $(id).onclick = (event) => {
    const button = event.target.closest('[data-unified-event]');
    if (!button || viewerRefresh.blocked) return;
    generationController?.abort();
    stop();
    followLatest = false;
    anchor = button.dataset.unifiedEvent;
    render();
    inspect();
    if (id === 'recap' && !developerView && !studioView) {
      $('explanation').setAttribute('tabindex', '-1');
      $('explanation').focus({ preventScroll: true });
      $('explanation').scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
        block: 'start',
      });
    }
  };
$('demo').onclick = () => {
  $('kind').value = 'central';
  followLatest = false;
  anchor = 'central-17-shot';
  connect(8);
};
$('catchup').onclick = () => {
  if (viewerRefresh.blocked) return;
  try {
    const since =
      $('lookback').value === 'all' ? 0 : Math.max(0, state.time - Number($('lookback').value));
    const result = catchup(state.eventHistory.values(), state.time, since, {
      ...preferences(),
      teams: fixtureTeams(preferences().kind, preferences().seed),
    });
    catchupPreferences = preferencesKey();
    catchupObservedAt = state.time;
    updateMarkup(
      $('catchup-result'),
      `<span class="pill">${stamp(since)}–${stamp(state.time)} · RECORDED CATCH-UP</span><p lang="${preferences().language}">${escape(result.summary)}</p>${result.consequence ? `<p lang="${preferences().language}">${escape(result.consequence)}</p>` : ''}<p class="disclosure" lang="${preferences().language}">${escape(result.accounting)}</p><p class="catchup-score">Score at ${stamp(state.time)}: ${escape(result.teams.home)} ${result.scoreNow.home}–${result.scoreNow.away} ${escape(result.teams.away)}</p>${result.highlights.map((e) => `<div class="catchup-moment"><time>${stamp(e.time)}</time><p>${escape(e.text)}</p><button class="secondary" data-unified-event="${escape(e.anchorId)}">View moment</button></div>`).join('')}${result.updates.map((e) => `<p class="correction-note">${escape(e.text)} Recorded at ${stamp(e.time)}, received at ${stamp(e.arrivedAt)}${e.withdrawn ? ' · withdrawn' : ''}.</p>`).join('')}<details><summary>Catch-up evidence and limitations</summary><p class="disclosure">${escape(result.limitation)}</p>${!result.baselineComplete ? '<p class="disclosure">The earlier score cannot be reconstructed from the revisions available in this view.</p>' : ''}<pre>${escape(JSON.stringify({ counts: result.countsEvidence, score: result.scoreEvidence, updates: result.updates }, null, 2))}</pre></details>`,
    );
  } catch (error) {
    catchupPreferences = null;
    catchupObservedAt = null;
    updateMarkup(
      $('catchup-result'),
      `<p role="alert">Could not prepare this catch-up: ${escape(error.message)}</p>`,
    );
  }
};
$('catchup-result').onclick = (event) => {
  const button = event.target.closest('[data-unified-event]');
  if (!button) return;
  generationController?.abort();
  stop();
  followLatest = false;
  anchor = button.dataset.unifiedEvent;
  render();
  inspect();
};
catchupShortcut.onclick = () => {
  stop();
  recapPanel.open = true;
  $('catchup').click();
  $('catchup').focus();
  render();
};
exampleButton.onclick = () => {
  $('kind').value = 'sustained';
  anchor = null;
  followLatest = true;
  connect(120);
};
mainFixtureButton.onclick = () => {
  $('kind').value = 'extended';
  anchor = null;
  followLatest = true;
  connect(0);
};
playerSpotlight.onclick = (event) => {
  if (event.target.closest('[data-choose-player]')) {
    preferencesPanel.open = true;
    $('player').focus();
    return;
  }
  const button = event.target.closest('[data-focus-event]');
  if (!button) return;
  generationController?.abort();
  stop();
  followLatest = false;
  anchor = button.dataset.focusEvent;
  render();
  inspect();
};
$('studio-preview').onclick = () => {
  try {
    studioLoader.reset();
    studioPreview = createStudioPreview(currentStudioCue(), { preferences: preferences() });
    studioValidatedKey = null;
    studioResult = null;
    studioPanel.open = true;
    renderStudioPreview();
  } catch {
    $('studio-status').textContent = 'A current canonical AI-selected moment story is required.';
  }
};
$('studio-clear').onclick = () => {
  studioLoader.reset();
  studioPreview = null;
  studioResult = null;
  studioValidatedKey = null;
  renderStudioPreview();
};
$('ai-result').onclick = (event) => {
  if (!event.target.closest('[data-studio-cue]')) return;
  try {
    const cue = buildStoryCue(draft, selected, {
      preferencesMatch: preferencesKey() === draftPreferences,
      observedAt: state.time,
      eventTime: selected.sequence.find((e) => e.id === selected.anchorId)?.time,
      language: preferences().language,
      audience: preferences().audience,
      factCatalog: { facts: draft.selectedFacts },
      receivedReferences: [...state.events.values()]
        .map((e) => ({ type: 'event', id: e.id, revision: e.revision }))
        .concat(selected.evidence, selected.patterns?.evidence || []),
    });
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(cue, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `studio-cue-${cue.anchorId}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('ai-status').textContent = 'Studio cue downloaded for review. It has not been published.';
  } catch (error) {
    $('ai-status').textContent = `Cue unavailable: ${error.message}`;
  }
};
$('draft').onclick = () => {
  if (busy) generationController?.abort();
  else generate(true, true);
};
$('agent').onclick = () => generate(true);
$('agent').textContent = 'Experimental free-prose draft';
async function refreshAIStatus({ preserveStatus = false } = {}) {
  try {
    const status = await (await fetch('/api/ai/status')).json();
    provider = status.provider;
    questionAvailable = status.questionAvailable !== false;
    configured = status.configured && !status.authRequired && status.available !== false;
    aiUnavailableReason = status.authRequired
      ? 'access'
      : /daily model-call limit/i.test(status.error || '')
        ? 'budget'
        : null;
    accessPanel.hidden = !status.authRequired;
    lockAccess.hidden = !status.accessConfigured || status.authRequired;
    aiAvailabilityMessage =
      status.error ||
      (status.authRequired
        ? 'Enter the project access code to enable AI.'
        : configured
          ? 'AI explanation available on request.'
          : 'AI explanation unavailable. Recorded insights remain available.');
    if (!developerView && !studioView && /daily model-call limit/i.test(aiAvailabilityMessage))
      aiAvailabilityMessage = 'AI explanations are temporarily unavailable.';
    if (!preserveStatus || !configured) $('ai-status').textContent = aiAvailabilityMessage;
    const focusedControl = document.activeElement;
    renderAI();
    if (
      (focusedControl === $('draft') || focusedControl === $('recap-draft')) &&
      focusedControl.disabled
    ) {
      const result = focusedControl === $('draft') ? $('ai-result') : $('recap-ai-result');
      (result.querySelector('summary') || $('play')).focus({ preventScroll: true });
    }
  } catch {
    configured = false;
    aiUnavailableReason = null;
    aiAvailabilityMessage = 'AI explanation unavailable. Recorded insights remain available.';
    $('ai-status').textContent = aiAvailabilityMessage;
    renderAI();
  }
}
$('access-form').onsubmit = async (event) => {
  event.preventDefault();
  const input = $('access-code'),
    button = event.currentTarget.querySelector('button');
  button.disabled = true;
  const accessStatus = $('access-status');
  input.removeAttribute('aria-invalid');
  if (accessStatus) accessStatus.textContent = 'Checking project access…';
  try {
    const response = await fetch('/api/access', {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.value}` },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'AI access failed.');
    input.value = '';
    await refreshAIStatus();
    if (accessStatus) {
      accessStatus.textContent = configured
        ? 'AI access enabled. Ask about the match.'
        : 'Access accepted. The match assistant is currently unavailable.';
      (matchChat.panel.querySelector('input') || $('play')).focus();
    } else if (configured) $('draft').focus();
  } catch (error) {
    $('ai-status').textContent = error.message;
    if (accessStatus) {
      accessStatus.textContent = error.message;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    }
  } finally {
    input.value = '';
    button.disabled = false;
  }
};
lockAccess.onclick = async () => {
  if (busy) generationController?.abort();
  try {
    const response = await fetch('/api/access', { method: 'DELETE' });
    if (!response.ok) throw new Error('Could not lock AI access.');
    await refreshAIStatus();
  } catch (error) {
    $('ai-status').textContent = error.message;
  }
};

function renderMatchBranding() {
  const names = fixtureTeams(preferences().kind, preferences().seed);
  $('club').querySelector('option[value="home"]').textContent = names.home;
  $('club').querySelector('option[value="away"]').textContent = names.away;
  const home = scoreStrip.querySelector('.score-club:not(.away)'),
    away = scoreStrip.querySelector('.score-club.away');
  home.lastElementChild.textContent = names.home;
  home.firstElementChild.textContent = names.home[0];
  away.firstElementChild.textContent = names.away;
  away.lastElementChild.textContent = names.away[0];
  pitchLegend.children[0].lastChild.textContent = names.home;
  pitchLegend.children[1].lastChild.textContent = names.away;
}
const requestedMatch = matchCatalogue.find(
  (m) => m.id === new URLSearchParams(location.search).get('match'),
);
const fixtureLabels = {
  sustained: 'Continuous buildup',
  interrupted: 'Interrupted attack',
  quiet: 'Quiet possession',
  counter: 'Counterattack',
  duel: 'End-to-end',
};
const matchLobby = document.createElement('section');
matchLobby.className = 'match-lobby';
matchLobby.setAttribute('aria-label', 'Choose a match');
matchLobby.innerHTML = `<p class="lobby-kicker">MATCH CENTRE</p><h1>Choose your match</h1><p class="lobby-intro">20 synthetic fixtures. Pick a match to watch and ask the AI.</p><ul class="match-list" aria-label="Available matches">${matchCatalogue.map((m) => `<li><a class="match-row" href="/?view=watch&match=${m.id}"><span class="match-row-status">${escape(fixtureLabels[m.kind] || m.kind)}</span><span class="match-row-clubs"><span class="match-row-team home"><b class="club-badge home" aria-hidden="true">${m.home[0]}</b><span>${m.home}</span></span><span class="match-versus">v</span><span class="match-row-team away"><b class="club-badge away" aria-hidden="true">${m.away[0]}</b><span>${m.away}</span></span></span><span class="match-row-enter">Watch <span aria-hidden="true">\u2192</span></span><span class="match-row-description">${escape(m.description)}</span></a></li>`).join('')}</ul><p class="lobby-note">Fictional clubs and players \u00b7 Two-minute match passages</p>`;
if (!developerView && !studioView) {
  lab.before(matchLobby);
  matchLobby.hidden = !!requestedMatch;
  lab.hidden = !requestedMatch;
  const matchBrowser = document.createElement('nav');
  matchBrowser.className = 'match-browser';
  matchBrowser.setAttribute('aria-label', 'Match library');
  const nearbyMatches = [
    ...new Map([requestedMatch, ...matchCatalogue].filter(Boolean).map((m) => [m.id, m])).values(),
  ].slice(0, 6);
  matchBrowser.innerHTML = `<div class="match-browser-heading"><span class="library-symbol" aria-hidden="true">&#9917;</span><h2>Match library</h2></div><p class="match-browser-label">Featured fixtures</p><ul>${nearbyMatches.map((m) => `<li><a href="/?view=watch&match=${m.id}" ${m.id === requestedMatch?.id ? 'aria-current="page"' : ''}><span class="rail-club-pair" aria-hidden="true"><b>${m.home[0]}</b><b>${m.away[0]}</b></span><span><strong>${escape(m.home)}</strong><small>vs ${escape(m.away)}</small></span></a></li>`).join('')}</ul><a class="match-browser-all" href="/?view=watch">All 20 fixtures <span aria-hidden="true">&#8594;</span></a><p class="match-browser-note">Fictional teams.<br>Real football questions.</p>`;
  document.querySelector('main').classList.add('fan-layout');
  matchLobby.before(matchBrowser);
  const allMatches = document.createElement('a');
  allMatches.href = '/?view=watch';
  allMatches.className = 'all-matches';
  allMatches.textContent = '\u2190 Matches';
  lab.querySelector('.audience-heading').prepend(allMatches);
}
const savedProfile = loadViewerPreferences(preferenceStorage());
applyViewerPreferences(savedProfile);
if (!developerView) {
  $('kind').value = requestedMatch?.kind || 'sustained';
  selectedSeed = requestedMatch?.seed || 17;
}
refreshAIStatus();
window.addEventListener('pagehide', () => {
  cancelAnimationFrame(motionFrame);
  stop();
  momentLoader.dispose();
  studioLoader.dispose();
  generationController?.abort();
  recapExportController?.abort();
  datasetController?.abort();
  clearInterval(generationTimer);
});
if (developerView || studioView || requestedMatch) connect(0);
