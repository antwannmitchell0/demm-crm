// Phase 2 -- agent contract suite.
//
// THREE DEFECTS THIS EXISTS TO CATCH
//
// 1. FABRICATION. `POST /agent/plan/preview` keyword-matched the description
//    and returned hard-coded steps that invented a contact ("Sarah
//    Wedding-Lead", sarah@wed.com) the user never mentioned. It was kept out of
//    the UI rather than removed, so the endpoint stayed reachable by anyone
//    holding a token. The dashboard brief separately asserted "No automations
//    failed today." on a product that has no automation engine at all -- an
//    unconditional string dressed up as a finding.
//
// 2. UNVALIDATED INPUT. `execute` and `execute/cancel` bound raw body
//    properties with @Body('name'), which bypasses the global ValidationPipe
//    entirely. A missing, wrongly-typed, or misspelled field reached the
//    service instead of being refused at the boundary -- the same class of hole
//    that once let a misspelled approval action take the APPROVE path.
//
// 3. UNDISCOVERABLE TOOLS. `GET /agent/tools` published a name, a description
//    and a permission list but no parameter schema, so nothing could tell a
//    caller which fields an action needs. The console had to guess, and a user
//    could not be shown a form.
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './src/app.module';
import { AgentService } from './src/modules/agent/agent.service';
import { DashboardService } from './src/modules/dashboard/dashboard.service';
import { assertDisposableTestDatabase } from './test-db-guard';
import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as jwt from 'jsonwebtoken';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

let pass = 0;
let fail = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`✅ [PASS] ${label}`);
    pass++;
  } else {
    console.log(`❌ [FAIL] ${label}${detail ? ` -- ${detail}` : ''}`);
    fail++;
  }
}

let activeApp: { close: () => Promise<void> } | null = null;
let cleanupCtx: { orgId: string; userIds: string[] } | null = null;

async function teardown() {
  if (activeApp) {
    await activeApp.close().catch(() => undefined);
    activeApp = null;
  }
  if (cleanupCtx) {
    await prisma.membership
      .deleteMany({ where: { userId: { in: cleanupCtx.userIds } } })
      .catch(() => undefined);
    await prisma.user
      .deleteMany({ where: { id: { in: cleanupCtx.userIds } } })
      .catch(() => undefined);
    await prisma.organization
      .delete({ where: { id: cleanupCtx.orgId } })
      .catch(() => undefined);
  }
  await prisma.$disconnect().catch(() => undefined);
}

function signToken(sub: string, email: string, workspaceId: string) {
  return jwt.sign({ sub, email, workspaceId }, process.env.JWT_SECRET!, {
    expiresIn: '15m',
  });
}

/**
 * Strips comments before searching source text. Without this, the assertions
 * below would match the very paragraphs that DOCUMENT the removed fabrication
 * and report a defect that no longer exists.
 */
function stripComments(src: string) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

async function main() {
  await assertDisposableTestDatabase('test-agent-contract.ts');

  console.log('🧪 PHASE 2 AGENT CONTRACT SUITE');
  console.log('==========================================================');

  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(0);
  activeApp = app;
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as any).port}`;

  const suffix = Date.now();
  const org = await prisma.organization.create({
    data: { name: `Agent Contract Org ${suffix}` },
  });
  const ws = await prisma.workspace.create({
    data: {
      organizationId: org.id,
      name: 'Agent Contract WS',
      subdomain: `agent-contract-${suffix}`,
    },
  });
  const admin = await prisma.user.create({
    data: {
      email: `agent-contract-${suffix}@example.invalid`,
      passwordHash: 'x',
      firstName: 'Ada',
      lastName: 'Admin',
    },
  });
  await prisma.membership.create({
    data: {
      userId: admin.id,
      organizationId: org.id,
      workspaceId: ws.id,
      role: Role.WORKSPACE_ADMIN,
      permissions: [],
    },
  });
  cleanupCtx = { orgId: org.id, userIds: [admin.id] };
  const token = signToken(admin.id, admin.email, ws.id);

  const post = (url: string, body: unknown) =>
    fetch(`${base}${url}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

  // ===== A. The fabrications are gone =====
  {
    const res = await post('/agent/plan/preview', {
      description: 'Create a wedding pipeline',
    });
    check(
      `1. POST /agent/plan/preview no longer exists (got ${res.status}, expected 404)`,
      res.status === 404,
    );

    const agentService = app.get(AgentService);
    check(
      '2. AgentService exposes no previewPlan method',
      typeof (agentService as any).previewPlan === 'undefined',
    );

    const src = stripComments(
      fs.readFileSync(
        path.join(__dirname, 'src/modules/agent/agent.service.ts'),
        'utf8',
      ),
    );
    const inventions = [
      'Wedding-Lead',
      'sarah@wed.com',
      'PLAN_PREVIEW',
      'Wedding Lead Pipeline',
    ];
    const found = inventions.filter((s) => src.includes(s));
    check(
      '3. No invented contact, email, or canned plan remains in agent.service.ts',
      found.length === 0,
      `found ${found.join(', ')}`,
    );
  }

  // ===== B. The dashboard states only what it measured =====
  {
    const dashboard = app.get(DashboardService);
    const data = await dashboard.getDashboardData(ws.id, admin);
    const brief: string = data.brief;

    check(
      '4. The brief makes no claim about automations',
      !/automation/i.test(brief),
      brief.split('\n').find((l) => /automation/i.test(l)),
    );
    check(
      '5. The brief still reports the counts it actually queried',
      brief.includes('new lead') &&
        brief.includes('follow-up') &&
        brief.includes('Revenue this month'),
    );
    check(
      '6. The brief still greets the user by name',
      brief.includes(admin.firstName!),
    );
  }

  // ===== C. Every agent endpoint validates at the boundary =====
  {
    const cases: Array<[string, string, unknown, number]> = [
      ['7. execute rejects a missing toolName', '/agent/execute', {}, 400],
      [
        '8. execute rejects a non-string toolName',
        '/agent/execute',
        { toolName: 42, arguments: {} },
        400,
      ],
      [
        '9. execute rejects an empty toolName',
        '/agent/execute',
        { toolName: '', arguments: {} },
        400,
      ],
      [
        '10. execute rejects an unknown extra body property',
        '/agent/execute',
        { toolName: 'getDashboard', arguments: {}, isAdmin: true },
        400,
      ],
      [
        '11. execute rejects a non-string sessionId',
        '/agent/execute',
        { toolName: 'getDashboard', arguments: {}, sessionId: { a: 1 } },
        400,
      ],
      [
        '12. execute rejects non-object arguments',
        '/agent/execute',
        { toolName: 'getDashboard', arguments: 'all of them' },
        400,
      ],
      [
        '13. cancel rejects a missing sessionId',
        '/agent/execute/cancel',
        {},
        400,
      ],
      [
        '14. cancel rejects an empty sessionId',
        '/agent/execute/cancel',
        { sessionId: '' },
        400,
      ],
      [
        '15. cancel rejects an unknown extra body property',
        '/agent/execute/cancel',
        { sessionId: 'abc', force: true },
        400,
      ],
    ];

    for (const [label, url, body, expected] of cases) {
      const res = await post(url, body);
      check(`${label} (got ${res.status})`, res.status === expected);
    }

    // Validation must refuse bad input WITHOUT refusing good input.
    const ok = await post('/agent/execute', {
      toolName: 'getDashboard',
      arguments: {},
    });
    check(
      `16. A well-formed execute still succeeds (got ${ok.status})`,
      ok.status === 200 || ok.status === 201,
    );

    const okCancel = await post('/agent/execute/cancel', {
      sessionId: `contract-${suffix}`,
    });
    check(
      `17. A well-formed cancel still succeeds (got ${okCancel.status})`,
      okCancel.status === 200 || okCancel.status === 201,
    );
  }

  // ===== D. Tools describe their own parameters =====
  {
    const res = await fetch(`${base}/agent/tools`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const tools: any[] = await res.json();

    check('18. GET /agent/tools returns the registry', Array.isArray(tools) && tools.length > 0);

    const missing = tools.filter((t) => !Array.isArray(t.parameters));
    check(
      '19. EVERY tool publishes a parameters array',
      missing.length === 0,
      `without parameters: ${missing.map((t) => t.name).join(', ')}`,
    );

    const shapeIsWrong = tools
      .flatMap((t) => (t.parameters ?? []).map((p: any) => ({ t: t.name, p })))
      .filter(
        ({ p }) =>
          typeof p?.name !== 'string' ||
          typeof p?.type !== 'string' ||
          typeof p?.required !== 'boolean' ||
          typeof p?.description !== 'string',
      );
    check(
      '20. Every parameter declares name, type, required and description',
      shapeIsWrong.length === 0,
      shapeIsWrong.map((x) => `${x.t}.${x.p?.name}`).join(', '),
    );

    const byName = (n: string) => tools.find((t) => t.name === n);

    const createContact = byName('createContact');
    const ccRequired = (createContact?.parameters ?? [])
      .filter((p: any) => p.required)
      .map((p: any) => p.name);
    check(
      `21. createContact names its required fields (got [${ccRequired.join(', ')}])`,
      ccRequired.includes('firstName'),
    );

    const moveOpp = byName('moveOpportunity');
    const moNames = (moveOpp?.parameters ?? []).map((p: any) => p.name);
    check(
      `22. moveOpportunity documents both ids it dereferences (got [${moNames.join(', ')}])`,
      moNames.includes('id') && moNames.includes('stageId'),
    );

    const search = byName('searchContacts');
    check(
      '23. searchContacts documents its query parameter',
      (search?.parameters ?? []).some((p: any) => p.name === 'query'),
    );

    // getDashboard takes nothing. An empty array is the honest answer; a
    // missing key would be indistinguishable from "not documented yet".
    const dash = byName('getDashboard');
    check(
      '24. A tool that takes no arguments publishes an empty array, not nothing',
      Array.isArray(dash?.parameters) && dash.parameters.length === 0,
    );

    // A high-risk tool must say so, otherwise a console cannot warn before
    // submitting an action that will stage an approval instead of running.
    const createOpp = byName('createOpportunity');
    check(
      '25. Tools declare whether they can trigger a high-risk approval',
      typeof createOpp?.canRequireApproval === 'boolean' &&
        createOpp.canRequireApproval === true &&
        byName('getDashboard')?.canRequireApproval === false,
    );
  }

  console.log('==========================================================');
  console.log(`📊 AGENT CONTRACT SUITE: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(teardown);
