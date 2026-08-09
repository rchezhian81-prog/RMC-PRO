import 'reflect-metadata';
import * as bcrypt from 'bcryptjs';
import { MODULE_CATALOG, PERMISSIONS, ROLE_KEYS } from '@rmc/shared';
import { AppDataSource } from './data-source';
import {
  Company,
  ConcreteGrade,
  Customer,
  Driver,
  Material,
  MixDesign,
  MixDesignMaterial,
  ModuleEntity,
  NumberSeries,
  StockBalance,
  Permission,
  Plant,
  PlanModule,
  Role,
  RolePermission,
  Site,
  SubscriptionPlan,
  Supplier,
  Tenant,
  TenantModule,
  TenantSetting,
  User,
  UserPlantAccess,
  UserRole,
  Vehicle,
} from './entities';

// Must satisfy the shared password policy (>=10 chars, letter+digit, no
// common-word prefix) because the e2e suite creates users through the API with
// it — a demo value that the API would reject makes the suite un-runnable.
const DEMO_PASSWORD = 'Concrete#2026';

async function main() {
  await AppDataSource.initialize();
  const m = AppDataSource.manager;

  await AppDataSource.query(
    `TRUNCATE tenants, users, permissions, companies, plants, roles,
     role_permissions, user_roles, user_plant_access,
     subscription_plans, plan_modules, modules, tenant_modules,
     number_series, tenant_settings, customers, sites, materials,
     suppliers, vehicles, drivers, concrete_grades
     RESTART IDENTITY CASCADE;`,
  );

  // Module catalog.
  await m.save(
    MODULE_CATALOG.map((mod) =>
      m.create(ModuleEntity, { moduleKey: mod.key, name: mod.name, phase: mod.phase }),
    ),
  );

  // Permission catalog (single source of truth in @rmc/shared).
  const perms = Object.values(PERMISSIONS).map((key) =>
    m.create(Permission, { permissionKey: key, moduleKey: key.split('.')[0] ?? 'core' }),
  );
  await m.save(perms);
  const allPerms = await m.find(Permission);

  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);

  async function seedTenant(code: string, name: string, adminEmail: string) {
    const tenant = await m.save(
      m.create(Tenant, { tenantCode: code, tenantName: name, status: 'active' }),
    );
    const company = await m.save(
      m.create(Company, { tenantId: tenant.id, companyName: name, state: 'TN' }),
    );
    const plants = await m.save([
      m.create(Plant, {
        tenantId: tenant.id,
        companyId: company.id,
        plantCode: `${code}-P1`,
        plantName: `${name} Plant 1`,
        city: 'Chennai',
      }),
      m.create(Plant, {
        tenantId: tenant.id,
        companyId: company.id,
        plantCode: `${code}-P2`,
        plantName: `${name} Plant 2`,
        city: 'Coimbatore',
      }),
    ]);

    const owner = await m.save(
      m.create(Role, {
        tenantId: tenant.id,
        roleKey: ROLE_KEYS.COMPANY_OWNER,
        roleName: 'Company Owner',
        isSystemRole: true,
      }),
    );
    const admin = await m.save(
      m.create(Role, {
        tenantId: tenant.id,
        roleKey: ROLE_KEYS.COMPANY_ADMIN,
        roleName: 'Company Admin',
        isSystemRole: true,
      }),
    );
    for (const role of [owner, admin]) {
      await m.save(
        allPerms.map((p) =>
          m.create(RolePermission, {
            tenantId: tenant.id,
            roleId: role.id,
            permissionId: p.id,
          }),
        ),
      );
    }

    const user = await m.save(
      m.create(User, {
        tenantId: tenant.id,
        name: `${name} Admin`,
        email: adminEmail,
        passwordHash,
        userType: 'tenant_user',
      }),
    );
    await m.save(m.create(UserRole, { tenantId: tenant.id, userId: user.id, roleId: admin.id }));
    await m.save(
      plants.map((pl) =>
        m.create(UserPlantAccess, {
          tenantId: tenant.id,
          userId: user.id,
          plantId: pl.id,
          accessLevel: 'manage',
        }),
      ),
    );
    return { tenant, adminEmail, plants };
  }

  const alpha = await seedTenant('ALPHA', 'Alpha Ready Mix', 'admin@alpha.test');
  await seedTenant('BETA', 'Beta Concrete', 'admin@beta.test');

  // Demo subscription plans.
  const starterModules = ['masters', 'sales', 'orders', 'dispatch', 'inventory', 'billing', 'reports'];
  const proModules = MODULE_CATALOG.filter((mod) => mod.phase === 1).map((mod) => mod.key);

  const starter = await m.save(
    m.create(SubscriptionPlan, {
      planCode: 'STARTER',
      planName: 'Starter',
      monthlyPrice: 2999,
      yearlyPrice: 29990,
      maxPlants: 1,
      maxUsers: 5,
    }),
  );
  const pro = await m.save(
    m.create(SubscriptionPlan, {
      planCode: 'PRO',
      planName: 'Professional',
      monthlyPrice: 7999,
      yearlyPrice: 79990,
      maxPlants: 5,
      maxUsers: 25,
    }),
  );
  await m.save(
    starterModules.map((k) => m.create(PlanModule, { planId: starter.id, moduleKey: k })),
  );
  await m.save(proModules.map((k) => m.create(PlanModule, { planId: pro.id, moduleKey: k })));

  // Assign Professional to Alpha (all Phase-1 modules) so the full order-to-cash
  // + production + offline-sync UAT can run end to end; Beta gets no plan
  // (modules off) so MODULE_NOT_ENABLED enforcement is demonstrable out of the box.
  await m.update(Tenant, alpha.tenant.id, { currentPlanId: pro.id });
  await m.save(
    proModules.map((k) =>
      m.create(TenantModule, { tenantId: alpha.tenant.id, moduleKey: k, isEnabled: true }),
    ),
  );

  // Demo master data for Alpha so the tenant portal shows records.
  const at = alpha.tenant.id;
  const customer = await m.save(
    m.create(Customer, {
      tenantId: at,
      customerCode: 'CUST001',
      customerName: 'L&T Construction',
      gstin: '33AAAAA0000A1Z5',
      state: 'TN',
      contactPerson: 'S. Kumar',
      mobile: '9840000001',
      creditLimit: 500000,
      creditDays: 30,
    }),
  );
  await m.save(
    m.create(Site, {
      tenantId: at,
      customerId: customer.id,
      siteCode: 'SITE001',
      siteName: 'Metro Rail Phase 2',
      city: 'Chennai',
      state: 'TN',
      pumpRequired: true,
    }),
  );
  const [cem53, agg20] = (await m.save([
    m.create(Material, { tenantId: at, materialCode: 'CEM53', materialName: 'OPC 53 Cement', category: 'cement', uom: 'bag', hsnCode: '2523' }),
    m.create(Material, { tenantId: at, materialCode: 'AGG20', materialName: '20mm Aggregate', category: 'aggregate', uom: 'ton', hsnCode: '2517' }),
  ])) as [Material, Material];
  await m.save(
    m.create(Supplier, {
      tenantId: at,
      supplierCode: 'SUP001',
      supplierName: 'UltraTech Cement Ltd',
      gstin: '27BBBBB1111B1Z5',
      state: 'MH',
      paymentTerms: '30 days',
    }),
  );
  const driver = await m.save(
    m.create(Driver, { tenantId: at, driverCode: 'DRV001', driverName: 'Ravi Kumar', mobile: '9840000010', licenseNo: 'TN1234567' }),
  );
  await m.save(
    m.create(Vehicle, {
      tenantId: at,
      vehicleNo: 'TN01AB1234',
      vehicleType: 'Transit Mixer',
      capacityM3: 6,
      ownershipType: 'own',
      driverId: driver.id,
    }),
  );
  const [m25] = (await m.save([
    m.create(ConcreteGrade, { tenantId: at, gradeCode: 'M25', gradeName: 'M25', strengthClass: '25 MPa' }),
    m.create(ConcreteGrade, { tenantId: at, gradeCode: 'M30', gradeName: 'M30', strengthClass: '30 MPa' }),
  ])) as [ConcreteGrade, ConcreteGrade];

  // Demo production readiness: opening stock at Plant 1 and an approved M25 mix
  // design, so a demo user can batch a load out of the box (Sprint 11 polish).
  const alphaPlant1 = alpha.plants[0]!;
  await m.save([
    m.create(StockBalance, { tenantId: at, plantId: alphaPlant1.id, materialId: cem53.id, materialLabel: cem53.materialName, currentQuantity: '2000', uom: cem53.uom, lastUpdatedAt: new Date() }),
    m.create(StockBalance, { tenantId: at, plantId: alphaPlant1.id, materialId: agg20.id, materialLabel: agg20.materialName, currentQuantity: '500', uom: agg20.uom, lastUpdatedAt: new Date() }),
  ]);
  const m25Mix = await m.save(
    m.create(MixDesign, {
      tenantId: at, plantId: alphaPlant1.id, gradeId: m25.id, mixCode: 'M25-STD', versionNo: 1,
      slumpMin: 100, slumpMax: 120, cementType: 'OPC 53', waterCementRatio: '0.45', pumpable: true,
      approvalStatus: 'approved', isActiveVersion: true,
    }),
  );
  await m.save([
    m.create(MixDesignMaterial, { tenantId: at, mixDesignId: m25Mix.id, materialId: cem53.id, materialLabel: cem53.materialName, targetQuantity: '7', uom: cem53.uom, tolerancePercentage: '2', sequenceNo: 1 }),
    m.create(MixDesignMaterial, { tenantId: at, mixDesignId: m25Mix.id, materialId: agg20.id, materialLabel: agg20.materialName, targetQuantity: '0.75', uom: agg20.uom, tolerancePercentage: '3', sequenceNo: 2 }),
  ]);
  await m.save(
    m.create(NumberSeries, {
      tenantId: at,
      documentType: 'delivery_challan',
      prefix: 'DC',
      paddingLength: 4,
      financialYear: '2026-27',
    }),
  );
  await m.save(
    m.create(TenantSetting, {
      tenantId: at,
      settingKey: 'credit_block_stage',
      settingValue: 'order_booking',
    }),
  );

  await m.save(
    m.create(User, {
      tenantId: null,
      name: 'Platform Super Admin',
      email: 'super@platform.test',
      passwordHash,
      userType: 'super_admin',
    }),
  );

  console.log(
    `Seed complete.\n  admin@alpha.test / admin@beta.test / super@platform.test\n  password: ${DEMO_PASSWORD}`,
  );
  await AppDataSource.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
