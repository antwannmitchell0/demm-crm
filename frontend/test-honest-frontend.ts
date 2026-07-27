// T10 + T11 -- automated tests for dashboard and Agent Console truthfulness.
//
// SCOPE NOTE, stated plainly: this runs in ONE Node process with no React
// renderer installed, so it proves two things:
//   1. DECISION LOGIC -- the pure state/vocabulary modules the pages render
//      from. These are real behavioural tests.
//   2. ABSENCE -- that specific fabricated strings and fake-behaviour patterns
//      are gone from the page sources and cannot quietly return.
// It does NOT prove what the rendered DOM looks like; that is verified
// separately in a real browser. See the T10+T11 report.
import * as fs from 'fs';
import * as path from 'path';

let pass = 0;
let fail = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`✅ [PASS] ${label}`);
    pass++;
  } else {
    console.log(`❌ [FAIL] ${label}`);
    fail++;
  }
}

/**
 * Reads a page's source with comments removed.
 *
 * The absence assertions below are about what the product SHOWS and DOES, not
 * about which words appear anywhere in the file. The new pages carry comments
 * naming exactly what was removed and why -- "Active Automated Playbooks",
 * "Sarah Connor", the `setTimeout` self-heal -- and that record is the main
 * thing stopping any of it from drifting back in. Grepping raw text would
 * force those explanations to be deleted, which is the opposite of the goal.
 * So comments are stripped first and the assertions run against real code.
 */
function readSource(relative: string): string {
  const raw = fs.readFileSync(path.join(__dirname, relative), 'utf8');
  return (
    raw
      // Block comments, including the JSX `{/* ... */}` form.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // Line comments. The negative lookbehind keeps `https://` intact.
      .replace(/(?<!:)\/\/.*$/gm, '')
  );
}

async function main() {
  console.log('🧪 T10 + T11 HONEST FRONTEND SUITE');
  console.log('==================================================');

  const { classifyDashboard, WORKFLOW_COPY } = await import(
    './src/components/dashboard/dashboardState'
  );
  const { describeAgentResponse, classifyToolList, summarizeArgumentFields } =
    await import('./src/components/agent/agentStatus');

  const dashboardSource = readSource('src/app/dashboard/page.tsx');
  const agentSource = readSource('src/app/agent/page.tsx');
  const bothSources = dashboardSource + '\n' + agentSource;

  // ===================== T10 -- DASHBOARD =====================

  // --- 1-4: the fabricated panel and its claims are gone ------------------
  check(
    '1. The fabricated "Active Automated Playbooks" panel is absent',
    !/Active Automated Playbooks/i.test(dashboardSource) &&
      !/playbook/i.test(dashboardSource),
  );
  check(
    '2. "AI Agent Self-Heal" and every self-heal handler are absent',
    !/self.?heal/i.test(dashboardSource) &&
      !/Agent Repairing/i.test(dashboardSource),
  );
  check(
    '3. The hard-coded workflow-failure alert is absent',
    !/Atlanta Photo Booth Workflow Failed/i.test(dashboardSource) &&
      !/API timeout on third-party mailer/i.test(dashboardSource),
  );
  check(
    '4. The fabricated recovery/health success claim is absent',
    !/All workflows resolved and healthy/i.test(dashboardSource) &&
      !/audit trail logged/i.test(dashboardSource),
  );
  check(
    '5. The invented system-health badge is absent',
    !/ACTIVE TENANT SYSTEM SECURE/i.test(dashboardSource),
  );
  check(
    '6. The unearned "AI Summary" label is absent (the backend brief is a template, not an LLM)',
    !/AI Summary/i.test(dashboardSource),
  );
  check(
    '7. No simulated delay or fake progress remains on the dashboard',
    !/setTimeout/.test(dashboardSource) && !/Simulate/i.test(dashboardSource),
  );

  // --- 8-12: honest state classification ---------------------------------
  const realStats = {
    leadsToday: 4,
    projectedRevenue: 18250,
    likelyToBookCount: 2,
    needsFollowup: 7,
    openDealsCount: 9,
  };
  const ready = classifyDashboard({
    loading: false,
    error: null,
    data: { stats: realStats },
  });
  check(
    '8. Real backend values classify as READY and are preserved exactly',
    ready.kind === 'READY' &&
      ready.stats.leadsToday === 4 &&
      ready.stats.projectedRevenue === 18250 &&
      ready.stats.openDealsCount === 9,
  );

  const zero = classifyDashboard({
    loading: false,
    error: null,
    data: {
      stats: {
        leadsToday: 0,
        projectedRevenue: 0,
        likelyToBookCount: 0,
        needsFollowup: 0,
        openDealsCount: 0,
      },
    },
  });
  check(
    `9. A genuine all-zero response is EMPTY, not an error and not fake activity (got "${zero.kind}")`,
    zero.kind === 'EMPTY',
  );

  const forbidden = classifyDashboard({
    loading: false,
    error: { status: 403, message: 'Access Denied' },
    data: null,
  });
  check(
    `10. A 403 classifies as FORBIDDEN, distinct from empty (got "${forbidden.kind}")`,
    forbidden.kind === 'FORBIDDEN',
  );

  const unavailable = classifyDashboard({
    loading: false,
    error: { status: 500, message: 'Request failed: 500' },
    data: null,
  });
  check(
    `11. A backend failure classifies as UNAVAILABLE (got "${unavailable.kind}")`,
    unavailable.kind === 'UNAVAILABLE',
  );
  check(
    '12. Loading is its own state, never confused with empty',
    classifyDashboard({ loading: true, error: null, data: null }).kind ===
      'LOADING',
  );

  // --- 13: the critical one -- a failure must never render as zero data ---
  const failureStates = [
    classifyDashboard({ loading: false, error: { status: 500 }, data: null }),
    classifyDashboard({ loading: false, error: { status: 403 }, data: null }),
    classifyDashboard({ loading: false, error: { status: 0 }, data: null }),
    // The pre-T10 defect: data stayed null after a failed fetch and every KPI
    // silently rendered `?? 0`, so an outage looked like a quiet business day.
    classifyDashboard({ loading: false, error: null, data: null }),
  ];
  check(
    '13. No failure or missing-data case is ever classified READY (an outage cannot look like real zeros)',
    failureStates.every((s) => s.kind !== 'READY' && s.kind !== 'EMPTY'),
  );

  // --- 14-15: future workflow copy ---------------------------------------
  check(
    '14. Workflow copy states plainly that nothing is active and the builder does not exist yet',
    WORKFLOW_COPY.heading === 'No workflows are active yet.' &&
      /not available in this version/i.test(WORKFLOW_COPY.detail),
  );
  check(
    '15. Workflow copy never claims the feature exists or is running now',
    !/(is running|are running|currently active|now available|is available)/i.test(
      WORKFLOW_COPY.heading + ' ' + WORKFLOW_COPY.detail,
    ),
  );
  check(
    '16. The dashboard adds no workflow-creation control',
    !/create workflow/i.test(dashboardSource) &&
      !/new workflow/i.test(dashboardSource) &&
      !/build workflow/i.test(dashboardSource),
  );

  // ===================== T11 -- AGENT CONSOLE =====================

  // --- 17-19: tool list comes only from the backend ----------------------
  const backendTools = [
    { name: 'searchContacts', description: 'Search contacts.' },
    { name: 'createContact', description: 'Create a new contact record.' },
  ];
  const listed = classifyToolList({ loading: false, error: null, tools: backendTools });
  check(
    '17. Tool options are exactly the backend response, in order',
    listed.kind === 'READY' &&
      listed.tools.length === 2 &&
      listed.tools[0].name === 'searchContacts' &&
      listed.tools[1].name === 'createContact',
  );
  const emptyList = classifyToolList({ loading: false, error: null, tools: [] });
  check(
    `18. An empty backend tool list stays empty -- no defaults are invented (got "${emptyList.kind}")`,
    emptyList.kind === 'EMPTY' &&
      (emptyList as { tools?: unknown[] }).tools === undefined,
  );
  const failedList = classifyToolList({
    loading: false,
    error: { status: 500, message: 'boom' },
    tools: null,
  });
  check(
    `19. A tool-list failure is an error state, never sample tools (got "${failedList.kind}")`,
    failedList.kind === 'UNAVAILABLE',
  );

  // --- 20-27: execution outcome vocabulary -------------------------------
  const success = describeAgentResponse({ status: 'SUCCESS', result: { id: 'c1' } });
  check(
    '20. SUCCESS is reported as executed',
    success.kind === 'SUCCESS' && success.hasExecuted === true,
  );

  const pending = describeAgentResponse({
    status: 'PENDING_APPROVAL',
    approvalId: 'ap_1',
    expiresAt: '2026-08-02T00:00:00.000Z',
    message: 'Human approval required',
  });
  check(
    '21. PENDING_APPROVAL says an administrator must approve it',
    pending.kind === 'APPROVAL_REQUIRED' &&
      /administrator/i.test(pending.headline),
  );
  check(
    '22. PENDING_APPROVAL explicitly reports that the action has NOT run',
    pending.kind === 'APPROVAL_REQUIRED' && pending.hasExecuted === false,
  );

  const failed = describeAgentResponse({ status: 'ERROR', error: 'Tool blew up' });
  check(
    '23. ERROR stays a failure and keeps the real backend message',
    failed.kind === 'FAILED' &&
      failed.hasExecuted === false &&
      failed.detail === 'Tool blew up',
  );
  check(
    '24. CANCELLED stays cancelled',
    describeAgentResponse({ status: 'CANCELLED', message: 'x' }).kind ===
      'CANCELLED',
  );
  check(
    '25. REJECTED and EXPIRED keep their own meanings',
    describeAgentResponse({ status: 'REJECTED' }).kind === 'REJECTED' &&
      describeAgentResponse({ status: 'EXPIRED' }).kind === 'EXPIRED',
  );

  // The pre-T11 defect: agentText defaulted to "Executed ... successfully"
  // BEFORE the status was inspected, so anything unrecognised read as success.
  const unknowns = [
    describeAgentResponse({ status: 'SOMETHING_NEW' }),
    describeAgentResponse({}),
    describeAgentResponse(null),
    describeAgentResponse(undefined),
  ];
  check(
    '26. An unrecognised, empty, or missing response NEVER reports success',
    unknowns.every((u) => u.kind === 'UNKNOWN' && u.hasExecuted === false),
  );
  check(
    '27. Only a real SUCCESS response sets hasExecuted',
    [pending, failed, ...unknowns].every((o) => o.hasExecuted === false),
  );

  // --- 28: arguments are never rendered by value -------------------------
  const fields = summarizeArgumentFields({
    name: 'Big deal',
    value: 12000,
    apiKey: 'sk-live-should-never-render',
    password: 'hunter2',
  });
  check(
    '28. Argument display lists FIELD NAMES only -- no value, sensitive or not, is returned',
    fields.join(',') === 'name,value,apiKey,password' &&
      !JSON.stringify(fields).includes('12000') &&
      !JSON.stringify(fields).includes('sk-live') &&
      !JSON.stringify(fields).includes('hunter2'),
  );
  check(
    '29. The console never stringifies raw arguments into the transcript',
    !/JSON\.stringify\(\s*[a-zA-Z.]*\bargs\b/.test(agentSource) &&
      !/JSON\.stringify\(m\.toolCall\.args\)/.test(agentSource),
  );

  // --- 30-34: fabricated agent behaviour is gone -------------------------
  check(
    '30. No invented default arguments remain',
    !/Sarah|Connor|sky\.net|Atlanta|Wedding-Lead/i.test(agentSource),
  );
  check(
    '31. No keyword "intent detection" pretending to understand free text',
    !/lower\.includes/.test(agentSource) &&
      !/Fallback simulated call/i.test(agentSource),
  );
  check(
    '32. No fake processing stage, simulated delay, or progress percentage',
    !/processing workflow outcomes/i.test(agentSource) &&
      !/setTimeout/.test(agentSource) &&
      !/progress/i.test(agentSource),
  );
  check(
    '33. The local history is not presented as the backend audit trail',
    !/Audit Trail History/i.test(agentSource),
  );
  check(
    '34. The fabricated backend plan preview is not surfaced',
    !/plan\/preview/.test(agentSource) && !/PLAN_PREVIEW/.test(agentSource),
  );

  // --- 35-36: approval policy is not bypassed client-side ----------------
  check(
    '35. The console contains no client-side approval-resolution call',
    !/approvals\//.test(agentSource) &&
      !/resolveApproval/i.test(agentSource) &&
      !/\bAPPROVE\b/.test(agentSource),
  );
  check(
    '36. No unexplained agent jargon is used in either page',
    !/autonomous|cognitive|agentic|remediation|orchestration/i.test(
      bothSources,
    ),
  );

  console.log('==================================================');
  console.log(`📊 T10 + T11 HONEST FRONTEND SUITE: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
