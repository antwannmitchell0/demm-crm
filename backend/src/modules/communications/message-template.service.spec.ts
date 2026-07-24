import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma.service';
import { MessageTemplateService } from './message-template.service';

describe('MessageTemplateService', () => {
  let service: MessageTemplateService;
  let prisma: PrismaService;
  let workspaceId: string;
  let businessUnitId: string;
  let orgId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [MessageTemplateService, PrismaService],
    }).compile();
    service = moduleRef.get(MessageTemplateService);
    prisma = moduleRef.get(PrismaService);

    const org = await prisma.organization.create({ data: { name: 'Tmpl Org' } });
    orgId = org.id;
    const bu = await prisma.businessUnit.create({ data: { name: 'Tmpl BU', key: 'TMPL', organizationId: org.id } });
    businessUnitId = bu.id;
    const ws = await prisma.workspace.create({
      data: { name: 'Tmpl WS', subdomain: `tmpl-${Date.now()}`, organizationId: org.id, businessUnitId: bu.id },
    });
    workspaceId = ws.id;
  });

  afterAll(async () => {
    await prisma.messageTemplate.deleteMany({ where: { workspaceId } });
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.businessUnit.delete({ where: { id: businessUnitId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it('create then resolve substitutes {{tokens}} with provided values', async () => {
    const template = await service.create({
      workspaceId,
      businessUnitId,
      channel: 'SMS',
      name: 'welcome',
      body: 'Hi {{firstName}}, thanks for reaching out to {{businessName}}!',
    });

    const resolved = service.resolve(template, { firstName: 'Jordan', businessName: 'DEMM' });
    expect(resolved).toBe('Hi Jordan, thanks for reaching out to DEMM!');
  });

  it('resolve leaves an unmatched token untouched rather than throwing', () => {
    const resolved = service.resolve(
      { body: 'Hi {{firstName}}, {{missingToken}} stays literal.' } as any,
      { firstName: 'Sam' },
    );
    expect(resolved).toBe('Hi Sam, {{missingToken}} stays literal.');
  });
});
