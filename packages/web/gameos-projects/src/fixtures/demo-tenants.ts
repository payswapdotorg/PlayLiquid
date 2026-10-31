/**
 * DEMO WORKBENCH TENANT IDENTITY (shared by the demo fixture parts): the
 * viewer's tenant, the deliberately confused foreign tenant (R20 guard
 * demo) and the two fixture authors. TEST-SUPPORT / DEMO FIXTURE ONLY
 * (lock rule 44) — nothing here is a production integration.
 */

import { asSubjectId, asTenantId } from "../../../../platform-contracts/src/index.ts";

/** The demo read model's viewer tenant (tenant scope, R20). */
export const DEMO_PROJECTS_TENANT = asTenantId("tenant-projects-demo")!;
/** The demo read model's viewer. */
export const DEMO_PROJECTS_VIEWER = asSubjectId("subject-projects-lead")!;
/** The confused-host foreign tenant (see module docs). */
export const DEMO_PROJECTS_FOREIGN_TENANT = asTenantId("tenant-p-demo")!;

export const AUTHOR = asSubjectId("subject-projects-author")!;
export const FOREIGN_AUTHOR = asSubjectId("subject-foreign-author")!;
