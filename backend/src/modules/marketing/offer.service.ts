import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { Offer, OfferLifecycleState, Prisma } from '@prisma/client';
import { CreateOfferDto, UpdateOfferDto } from './dto/offer.dto';

/**
 * Any Prisma client with the same query API shape as PrismaService --
 * either the top-level PrismaService, or the `tx` callback client handed
 * out inside `prisma.$transaction(async (tx) => {...})`. This lets
 * `assertSellable` be called standalone (tests, simple call sites) AND from
 * inside a caller's own transaction (Task 7's conversion flow) without
 * opening a nested transaction.
 */
type PrismaClientLike = PrismaService | Prisma.TransactionClient;

/**
 * Commercial fields that define what a client is actually buying. Changing
 * any of these on an ACTIVE offer must NOT silently rewrite the terms a
 * client already agreed to -- so a change bumps the version (a new Offer
 * row) instead of mutating the row in place.
 *
 * `name` and `isPubliclyAvailable` are presentation/visibility only -- they
 * don't change what's being delivered, billed, or supported, so they're
 * safe to edit in place on the same row at any lifecycle state.
 */
const MATERIAL_FIELDS = [
  'price',
  'setupFee',
  'includedServices',
  'excludedServices',
  'onboardingRequirements',
  'supportBoundaries',
  'reportingCadence',
  'cancellationTerms',
  'expectedLaunchTime',
] as const;

type MaterialField = (typeof MATERIAL_FIELDS)[number];

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function decimalEqual(
  a: Prisma.Decimal | null,
  b: number | undefined,
): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a.equals(new Prisma.Decimal(b));
}

@Injectable()
export class OfferService {
  constructor(private prisma: PrismaService) {}

  async findAll(businessUnitId: string) {
    return this.prisma.offer.findMany({
      where: { businessUnitId },
      orderBy: [{ key: 'asc' }, { version: 'desc' }],
    });
  }

  async findByIdScoped(businessUnitId: string, id: string): Promise<Offer> {
    const offer = await this.prisma.offer.findFirst({
      where: { id, businessUnitId },
    });
    if (!offer) {
      throw new NotFoundException('Offer not found in this Business Unit');
    }
    return offer;
  }

  async create(businessUnitId: string, dto: CreateOfferDto): Promise<Offer> {
    return this.prisma.offer.create({
      data: {
        businessUnitId,
        key: dto.key,
        version: 1,
        name: dto.name,
        price: new Prisma.Decimal(dto.price),
        setupFee:
          dto.setupFee !== undefined ? new Prisma.Decimal(dto.setupFee) : null,
        includedServices: dto.includedServices,
        excludedServices: dto.excludedServices,
        onboardingRequirements: dto.onboardingRequirements,
        supportBoundaries: dto.supportBoundaries,
        reportingCadence: dto.reportingCadence,
        cancellationTerms: dto.cancellationTerms,
        expectedLaunchTime: dto.expectedLaunchTime,
        lifecycleState: OfferLifecycleState.DRAFT,
        isPubliclyAvailable: dto.isPubliclyAvailable ?? false,
      },
    });
  }

  /**
   * Update an offer's fields.
   *
   * - On a DRAFT or RETIRED offer: every field (material or not) is updated
   *   in place on the same row. DRAFT offers have no clients depending on
   *   their exact terms yet, and RETIRED offers are no longer sellable, so
   *   there's nothing to protect by version-bumping in either state.
   * - On an ACTIVE offer: if any MATERIAL_FIELDS value actually changes,
   *   the existing row is left untouched (it's the historical record of
   *   what any client who bought under it actually agreed to) and a NEW
   *   Offer row is inserted with the same `key`, `version + 1`, and the
   *   merged fields (old row's values overlaid with the dto's changes).
   *   The new row is created as DRAFT -- bumping a version does not
   *   auto-publish it. The old ACTIVE row keeps serving as the sellable
   *   offer for that key until someone explicitly promotes the new
   *   version via setLifecycle(DRAFT -> ACTIVE). This avoids two
   *   surprises: (a) client-visible terms changing underneath anyone
   *   already sold on the old version, and (b) a key going dark (no
   *   ACTIVE row) the instant a material edit is saved.
   *   If only non-material fields (name / isPubliclyAvailable) changed,
   *   the ACTIVE row is updated in place -- no version bump.
   */
  async update(
    businessUnitId: string,
    id: string,
    dto: UpdateOfferDto,
  ): Promise<Offer> {
    const current = await this.findByIdScoped(businessUnitId, id);

    if (current.lifecycleState !== OfferLifecycleState.ACTIVE) {
      return this.prisma.offer.update({
        where: { id: current.id },
        data: this.buildUpdateData(dto),
      });
    }

    const materialChanged = this.hasMaterialChange(current, dto);

    if (!materialChanged) {
      return this.prisma.offer.update({
        where: { id: current.id },
        data: this.buildUpdateData(dto),
      });
    }

    return this.prisma.offer.create({
      data: {
        businessUnitId,
        key: current.key,
        version: current.version + 1,
        name: dto.name ?? current.name,
        price:
          dto.price !== undefined
            ? new Prisma.Decimal(dto.price)
            : current.price,
        setupFee:
          dto.setupFee !== undefined
            ? new Prisma.Decimal(dto.setupFee)
            : current.setupFee,
        includedServices: dto.includedServices ?? current.includedServices,
        excludedServices: dto.excludedServices ?? current.excludedServices,
        onboardingRequirements:
          dto.onboardingRequirements ?? current.onboardingRequirements,
        supportBoundaries: dto.supportBoundaries ?? current.supportBoundaries,
        reportingCadence: dto.reportingCadence ?? current.reportingCadence,
        cancellationTerms: dto.cancellationTerms ?? current.cancellationTerms,
        expectedLaunchTime:
          dto.expectedLaunchTime ?? current.expectedLaunchTime,
        lifecycleState: OfferLifecycleState.DRAFT,
        isPubliclyAvailable:
          dto.isPubliclyAvailable ?? current.isPubliclyAvailable,
      },
    });
  }

  private hasMaterialChange(current: Offer, dto: UpdateOfferDto): boolean {
    const checks: Record<MaterialField, () => boolean> = {
      price: () =>
        dto.price !== undefined && !decimalEqual(current.price, dto.price),
      setupFee: () =>
        dto.setupFee !== undefined &&
        !decimalEqual(current.setupFee, dto.setupFee),
      includedServices: () =>
        dto.includedServices !== undefined &&
        !arraysEqual(current.includedServices, dto.includedServices),
      excludedServices: () =>
        dto.excludedServices !== undefined &&
        !arraysEqual(current.excludedServices, dto.excludedServices),
      onboardingRequirements: () =>
        dto.onboardingRequirements !== undefined &&
        !arraysEqual(
          current.onboardingRequirements,
          dto.onboardingRequirements,
        ),
      supportBoundaries: () =>
        dto.supportBoundaries !== undefined &&
        dto.supportBoundaries !== current.supportBoundaries,
      reportingCadence: () =>
        dto.reportingCadence !== undefined &&
        dto.reportingCadence !== current.reportingCadence,
      cancellationTerms: () =>
        dto.cancellationTerms !== undefined &&
        dto.cancellationTerms !== current.cancellationTerms,
      expectedLaunchTime: () =>
        dto.expectedLaunchTime !== undefined &&
        dto.expectedLaunchTime !== current.expectedLaunchTime,
    };
    return MATERIAL_FIELDS.some((field) => checks[field]());
  }

  /** Builds a Prisma update payload for an in-place (same-row) edit. */
  private buildUpdateData(dto: UpdateOfferDto): Prisma.OfferUpdateInput {
    const data: Prisma.OfferUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.price !== undefined) data.price = new Prisma.Decimal(dto.price);
    if (dto.setupFee !== undefined)
      data.setupFee = new Prisma.Decimal(dto.setupFee);
    if (dto.includedServices !== undefined)
      data.includedServices = dto.includedServices;
    if (dto.excludedServices !== undefined)
      data.excludedServices = dto.excludedServices;
    if (dto.onboardingRequirements !== undefined)
      data.onboardingRequirements = dto.onboardingRequirements;
    if (dto.supportBoundaries !== undefined)
      data.supportBoundaries = dto.supportBoundaries;
    if (dto.reportingCadence !== undefined)
      data.reportingCadence = dto.reportingCadence;
    if (dto.cancellationTerms !== undefined)
      data.cancellationTerms = dto.cancellationTerms;
    if (dto.expectedLaunchTime !== undefined)
      data.expectedLaunchTime = dto.expectedLaunchTime;
    if (dto.isPubliclyAvailable !== undefined)
      data.isPubliclyAvailable = dto.isPubliclyAvailable;
    return data;
  }

  /**
   * Lifecycle is a forward-only, one-directional line: DRAFT -> ACTIVE ->
   * RETIRED. Allowed moves are exactly DRAFT->ACTIVE and ACTIVE->RETIRED.
   * Everything else is rejected, specifically:
   *   - RETIRED -> anything: retirement is terminal. A retired offer may
   *     have live snapshots/ClientAccounts referencing it as history; it
   *     must never become sellable again under the same identity. If the
   *     business wants to resurrect the terms, that's a new `create()`
   *     (a new key or a fresh version), not a state reversal.
   *   - ACTIVE -> DRAFT: would pull a currently-sellable offer back into
   *     drafting invisibly; the material-change path in `update()` already
   *     covers "I need to change an ACTIVE offer's terms" without ever
   *     leaving the key unsellable, so backward-to-DRAFT has no legitimate
   *     use.
   *   - DRAFT -> RETIRED: skips ACTIVE entirely. Retiring something that
   *     was never live is meaningless (nothing to wind down); if a draft is
   *     abandoned it should just stay a DRAFT (or be deleted), not recorded
   *     as "retired."
   *   - Any state -> itself: a no-op is not a transition; rejected so
   *     callers get a clear signal their state machine assumption is wrong
   *     rather than a silently-swallowed no-op.
   */
  async setLifecycle(
    businessUnitId: string,
    id: string,
    state: OfferLifecycleState,
  ): Promise<Offer> {
    const current = await this.findByIdScoped(businessUnitId, id);

    const allowed: Partial<Record<OfferLifecycleState, OfferLifecycleState>> = {
      [OfferLifecycleState.DRAFT]: OfferLifecycleState.ACTIVE,
      [OfferLifecycleState.ACTIVE]: OfferLifecycleState.RETIRED,
    };

    if (allowed[current.lifecycleState] !== state) {
      throw new BadRequestException(
        `Cannot transition offer from ${current.lifecycleState} to ${state}`,
      );
    }

    return this.prisma.offer.update({
      where: { id: current.id },
      data: { lifecycleState: state },
    });
  }

  /**
   * Guards the one invariant a sale can never violate: the offer being sold
   * must actually be ACTIVE right now. Designed to be called from INSIDE a
   * future conversion transaction (Task 7) by passing that transaction's
   * `tx` client -- it never opens its own transaction, so nesting is safe.
   *
   * Failure modes are deliberately distinct so callers (and API consumers)
   * can tell "this offer doesn't exist" apart from "this offer exists but
   * isn't yours" apart from "this offer is yours but isn't sellable":
   *   - 404 NotFoundException: no Offer with this id exists at all.
   *   - 403 ForbiddenException: the offer exists but belongs to a
   *     different Business Unit -- this is a scope violation, not a normal
   *     "not found," since a caller probing offer ids across BUs should get
   *     a distinguishable signal in server logs even though the HTTP body
   *     shouldn't leak details.
   *   - 422 UnprocessableEntityException: the offer is correctly scoped
   *     but its lifecycleState isn't ACTIVE (still DRAFT or already
   *     RETIRED) -- the request was well-formed, the resource exists, but
   *     the current state makes it impossible to fulfill.
   *
   * Returns the found Offer so callers (e.g. the conversion transaction)
   * can read its price/terms without an extra round trip.
   */
  async assertSellable(
    client: PrismaClientLike,
    businessUnitId: string,
    offerId: string,
  ): Promise<Offer> {
    const offer = await client.offer.findUnique({ where: { id: offerId } });

    if (!offer) {
      throw new NotFoundException('Offer not found');
    }
    if (offer.businessUnitId !== businessUnitId) {
      throw new ForbiddenException(
        'Offer does not belong to this Business Unit',
      );
    }
    if (offer.lifecycleState !== OfferLifecycleState.ACTIVE) {
      throw new UnprocessableEntityException(
        `Offer is not sellable (lifecycleState=${offer.lifecycleState})`,
      );
    }

    return offer;
  }
}
