export type RoleInventoryFilter = 'all' | 'configured' | 'unconfigured' | 'managed' | 'root';
export type RoleInventorySort = 'hierarchy' | 'name' | 'policy';

export interface RoleInventoryRole {
  id: string;
  name: string;
  color: string;
  position: number;
  managed: boolean;
  mentionable: boolean;
  editable: boolean;
}

export interface RoleInventorySummary {
  total: number;
  configured: number;
  unconfigured: number;
  managed: number;
  root: number;
}

export interface RoleInventoryPage<T> {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
  from: number;
  to: number;
}

export function summarizeRoleInventory(
  roles: readonly RoleInventoryRole[],
  configuredRoleIds: ReadonlySet<string>,
  rootRoleId: string,
): RoleInventorySummary {
  let configured = 0;
  let unconfigured = 0;
  let managed = 0;
  let root = 0;

  for (const role of roles) {
    if (role.id === rootRoleId) root += 1;
    else if (configuredRoleIds.has(role.id)) configured += 1;
    else unconfigured += 1;
    if (role.managed) managed += 1;
  }

  return { total: roles.length, configured, unconfigured, managed, root };
}

export function filterAndSortRoleInventory(
  roles: readonly RoleInventoryRole[],
  options: {
    query: string;
    filter: RoleInventoryFilter;
    sort: RoleInventorySort;
    configuredRoleIds: ReadonlySet<string>;
    rootRoleId: string;
  },
): RoleInventoryRole[] {
  const normalizedQuery = options.query.trim().toLocaleLowerCase('ja');
  const filtered = roles.filter((role) => {
    if (
      normalizedQuery &&
      !role.name.toLocaleLowerCase('ja').includes(normalizedQuery) &&
      !role.id.includes(normalizedQuery)
    ) {
      return false;
    }

    const configured = options.configuredRoleIds.has(role.id);
    switch (options.filter) {
      case 'configured':
        return configured;
      case 'unconfigured':
        return role.id !== options.rootRoleId && !configured;
      case 'managed':
        return role.managed;
      case 'root':
        return role.id === options.rootRoleId;
      default:
        return true;
    }
  });

  return [...filtered].sort((left, right) => {
    if (options.sort === 'name') {
      return compareRoleName(left, right);
    }
    if (options.sort === 'policy') {
      const statusDifference =
        rolePolicySortWeight(left.id, options.configuredRoleIds, options.rootRoleId) -
        rolePolicySortWeight(right.id, options.configuredRoleIds, options.rootRoleId);
      if (statusDifference !== 0) return statusDifference;
    }
    return compareRoleHierarchy(left, right);
  });
}

export function paginateRoleInventory<T>(
  items: readonly T[],
  requestedPage: number,
  pageSize: number,
): RoleInventoryPage<T> {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(items.length / safePageSize));
  const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), pageCount);
  const start = (page - 1) * safePageSize;
  const pageItems = items.slice(start, start + safePageSize);

  return {
    items: pageItems,
    page,
    pageCount,
    total: items.length,
    from: items.length === 0 ? 0 : start + 1,
    to: items.length === 0 ? 0 : start + pageItems.length,
  };
}

function compareRoleHierarchy(left: RoleInventoryRole, right: RoleInventoryRole): number {
  if (left.position !== right.position) return right.position - left.position;
  return compareRoleName(left, right);
}

function compareRoleName(left: RoleInventoryRole, right: RoleInventoryRole): number {
  const byName = left.name.localeCompare(right.name, 'ja', { sensitivity: 'base' });
  return byName !== 0 ? byName : left.id.localeCompare(right.id);
}

function rolePolicySortWeight(
  roleId: string,
  configuredRoleIds: ReadonlySet<string>,
  rootRoleId: string,
): number {
  if (roleId === rootRoleId) return 0;
  if (configuredRoleIds.has(roleId)) return 1;
  return 2;
}
