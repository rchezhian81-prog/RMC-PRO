import 'reflect-metadata';
import * as bcrypt from 'bcryptjs';
import { PERMISSIONS, ROLE_KEYS } from '@rmc/shared';
import { AppDataSource } from './data-source';
import {
  Company,
  Permission,
  Plant,
  Role,
  RolePermission,
  Tenant,
  User,
  UserPlantAccess,
  UserRole,
} from './entities';

const DEMO_PASSWORD = 'Passw0rd!';

async function main() {
  await AppDataSource.initialize();
  const m = AppDataSource.manager;

  await AppDataSource.query(
    `TRUNCATE tenants, users, permissions, companies, plants, roles,
     role_permissions, user_roles, user_plant_access RESTART IDENTITY CASCADE;`,
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
    return { tenant, adminEmail };
  }

  await seedTenant('ALPHA', 'Alpha Ready Mix', 'admin@alpha.test');
  await seedTenant('BETA', 'Beta Concrete', 'admin@beta.test');

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
