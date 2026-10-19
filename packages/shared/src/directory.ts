// Справочник пользователей для платформенных сервисов (движок согласований, уведомления).
// По умолчанию читает демо-данные; api/mock.ts подключает живые таблицы (setDirectory), а оргструктура
// (P1-ORG, org.ts) может переопределить branchOf/managerOf — движок об этом не знает.
import * as seed from './mock/data';
import type { Department, ID, Role, User } from './types';

export interface DirectorySource {
  users(): User[];
  departments(): Department[];
  /** Филиал/ЦБУ пользователя (для шагов «роль в филиале инициатора»). */
  branchOf?(user: User): ID | undefined;
  /** Непосредственный руководитель (для эскалации по SLA). */
  managerOf?(user: User): User | undefined;
}

let source: DirectorySource = { users: () => seed.users, departments: () => seed.departments };

/** Подключить живые данные или переопределить правила (частично). */
export function setDirectory(next: Partial<DirectorySource>): void {
  source = { ...source, ...next };
}

const isActive = (u: User) => u.active !== false;

export const directory = {
  users(): User[] {
    return source.users().filter(isActive);
  },
  user(id: ID | undefined): User | undefined {
    return id ? source.users().find((u) => u.id === id) : undefined;
  },
  departments(): Department[] {
    return source.departments();
  },
  department(id: ID | undefined): Department | undefined {
    return id ? source.departments().find((d) => d.id === id) : undefined;
  },
  rolesOf(user: User): Role[] {
    return [user.role, ...(user.extraRoles ?? [])];
  },
  hasRole(user: User, role: Role): boolean {
    return user.role === role || !!user.extraRoles?.includes(role);
  },
  byRole(role: Role): User[] {
    return directory.users().filter((u) => directory.hasRole(u, role));
  },
  admins(): User[] {
    return directory.byRole('admin');
  },
  /** Руководитель подразделения (Department.headId). */
  headOf(departmentId: ID | undefined): User | undefined {
    return directory.user(directory.department(departmentId)?.headId);
  },
  branchOf(user: User | undefined): ID | undefined {
    if (!user) return undefined;
    if (source.branchOf) return source.branchOf(user);
    const ext = user as User & { branchId?: ID };
    return ext.branchId ?? user.orgUnitKey;
  },
  /** Руководитель: явный managerId → руководитель подразделения (если это не сам пользователь). */
  managerOf(user: User | undefined): User | undefined {
    if (!user) return undefined;
    if (source.managerOf) return source.managerOf(user);
    const ext = user as User & { managerId?: ID };
    const explicit = directory.user(ext.managerId);
    if (explicit && explicit.id !== user.id) return explicit;
    const head = directory.headOf(user.departmentId);
    return head && head.id !== user.id ? head : undefined;
  },
};
