import { AuthService } from '../../core/services/auth.service';
import { BranchService } from '../../core/services/branch.service';

/**
 * The branch the user is working in — what every stock figure on an inventory
 * screen is about, and what the backend will write to.
 *
 * `BranchService` holds the branch switcher's choice, which is the id the auth
 * interceptor sends as `X-Branch-Id`. When nothing is stored (no switch made
 * yet) the answer is the user's OWN branch, because that is exactly what the
 * server falls back to when no header arrives. Reading only the switcher left
 * the id null on a plain login, which quietly turned every figure into an
 * all-branch total.
 */
export interface OperatingBranch {
  id: number | null;
  name: string;
}

export function operatingBranch(
  branch: BranchService,
  auth: AuthService
): OperatingBranch {
  const selected = branch.getCurrentBranch();
  if (selected?.id != null && String(selected.id) !== '') {
    return { id: Number(selected.id), name: selected.name || '' };
  }
  const own = auth.getCurrentUser()?.branchId;
  return { id: own != null ? Number(own) : null, name: '' };
}

/**
 * On-hand stock for ONE branch, out of the inventory rows a product carries.
 *
 * `GET /products/:id` returns an `inventory` row per branch, but every screen
 * that shows or moves stock works in a single branch — the one the auth
 * interceptor sends as `X-Branch-Id`. Taking `inventory[0]` landed on whichever
 * branch Prisma returned first (often a qty-0 sibling), and summing every row
 * both overstated the figure and made a per-branch delta meaningless. Both
 * mistakes have already shipped once, so the rule lives in one place.
 *
 * `branchId` null means no branch is known at all: the all-branch total then
 * beats silently showing 0, but callers must not derive an adjustment from it.
 */
export interface BranchInventoryRow {
  quantity: number | string;
  branchId: number;
}

export function stockForBranch(
  inventory: BranchInventoryRow[] | undefined | null,
  branchId: number | null
): number {
  if (!inventory || inventory.length === 0) return 0;
  if (branchId != null) {
    const row = inventory.find((i) => Number(i.branchId) === branchId);
    return row ? Number(row.quantity) || 0 : 0;
  }
  return inventory.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
}
