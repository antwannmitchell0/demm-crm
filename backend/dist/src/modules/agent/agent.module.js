"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentModule = void 0;
const common_1 = require("@nestjs/common");
const agent_service_1 = require("./agent.service");
const agent_controller_1 = require("./agent.controller");
const contact_module_1 = require("../contact/contact.module");
const pipeline_module_1 = require("../pipeline/pipeline.module");
const opportunity_module_1 = require("../opportunity/opportunity.module");
const dashboard_module_1 = require("../dashboard/dashboard.module");
const prisma_service_1 = require("../../prisma.service");
let AgentModule = class AgentModule {
};
exports.AgentModule = AgentModule;
exports.AgentModule = AgentModule = __decorate([
    (0, common_1.Module)({
        imports: [contact_module_1.ContactModule, pipeline_module_1.PipelineModule, opportunity_module_1.OpportunityModule, dashboard_module_1.DashboardModule],
        controllers: [agent_controller_1.AgentController],
        providers: [agent_service_1.AgentService, prisma_service_1.PrismaService],
        exports: [agent_service_1.AgentService],
    })
], AgentModule);
//# sourceMappingURL=agent.module.js.map