"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
const pg_1 = require("pg");
const bcrypt = __importStar(require("bcrypt"));
const connectionString = process.env.DATABASE_URL || 'postgresql://antwannmitchellsr@localhost:5432/demm_crm';
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
async function main() {
    console.log('🧪 Starting Tenant Isolation verification tests...');
    await prisma.activity.deleteMany();
    await prisma.note.deleteMany();
    await prisma.opportunity.deleteMany();
    await prisma.stage.deleteMany();
    await prisma.pipeline.deleteMany();
    await prisma.contact.deleteMany();
    await prisma.company.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.user.deleteMany();
    await prisma.workspace.deleteMany();
    await prisma.organization.deleteMany();
    console.log('\nStep 1: Creating Tenant A organization & workspace...');
    const orgA = await prisma.organization.create({
        data: { name: 'Alpha Agency Org' },
    });
    const workspaceA = await prisma.workspace.create({
        data: { name: 'Alpha Agency', subdomain: 'alpha', organizationId: orgA.id },
    });
    const hashA = await bcrypt.hash('alpha-pass', 10);
    const userA = await prisma.user.create({
        data: {
            email: 'owner@alpha.com',
            passwordHash: hashA,
            firstName: 'Alan',
            lastName: 'Alpha',
        },
    });
    await prisma.membership.create({
        data: {
            userId: userA.id,
            organizationId: orgA.id,
            workspaceId: workspaceA.id,
            role: client_1.Role.ORG_OWNER,
            permissions: ['*'],
        },
    });
    const contactA = await prisma.contact.create({
        data: {
            firstName: 'John',
            lastName: 'Doe',
            emails: ['john@doe.com'],
            workspaceId: workspaceA.id,
            ownerId: userA.id,
        },
    });
    console.log(`Created Contact '${contactA.firstName} ${contactA.lastName}' in Workspace A (ID: ${workspaceA.id})`);
    console.log('\nStep 2: Creating Tenant B organization & workspace...');
    const orgB = await prisma.organization.create({
        data: { name: 'Beta Biz Org' },
    });
    const workspaceB = await prisma.workspace.create({
        data: { name: 'Beta Biz', subdomain: 'beta', organizationId: orgB.id },
    });
    const hashB = await bcrypt.hash('beta-pass', 10);
    const userB = await prisma.user.create({
        data: {
            email: 'owner@beta.com',
            passwordHash: hashB,
            firstName: 'Bob',
            lastName: 'Beta',
        },
    });
    await prisma.membership.create({
        data: {
            userId: userB.id,
            organizationId: orgB.id,
            workspaceId: workspaceB.id,
            role: client_1.Role.ORG_OWNER,
            permissions: ['*'],
        },
    });
    const contactB = await prisma.contact.create({
        data: {
            firstName: 'Jane',
            lastName: 'Smith',
            emails: ['jane@smith.com'],
            workspaceId: workspaceB.id,
            ownerId: userB.id,
        },
    });
    console.log(`Created Contact '${contactB.firstName} ${contactB.lastName}' in Workspace B (ID: ${workspaceB.id})`);
    console.log('\nStep 3: Verifying query isolation...');
    const contactsA = await prisma.contact.findMany({
        where: { workspaceId: workspaceA.id },
    });
    console.log(`Querying Workspace A contacts: Found ${contactsA.length} contact(s).`);
    const hasOnlyJohn = contactsA.every(c => c.firstName === 'John');
    const contactsB = await prisma.contact.findMany({
        where: { workspaceId: workspaceB.id },
    });
    console.log(`Querying Workspace B contacts: Found ${contactsB.length} contact(s).`);
    const hasOnlyJane = contactsB.every(c => c.firstName === 'Jane');
    const hasCrossAccess = contactsB.some(c => c.id === contactA.id) || contactsA.some(c => c.id === contactB.id);
    if (hasOnlyJohn && hasOnlyJane && !hasCrossAccess) {
        console.log('\n✅ TENANT ISOLATION VERIFIED SUCCESSFULLY! No workspace can access another workspace.');
    }
    else {
        console.error('\n❌ ISOLATION TEST FAILED!');
        process.exit(1);
    }
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
});
//# sourceMappingURL=test-isolation.js.map