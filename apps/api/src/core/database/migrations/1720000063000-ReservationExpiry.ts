import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A number block issued to an offline device never stopped being valid.
 *
 * Two consequences. A decommissioned or lost tablet kept an "active" block for
 * ever, so the office had no way to tell a live reservation from a dead one.
 * Worse, after a financial-year roll-over a device kept formatting numbers from
 * a block issued in the PREVIOUS year — with the previous year's suffix — and
 * pushed documents numbered as last year's into this year's books.
 *
 * `financial_year` records which year a block belongs to and `expires_at` when
 * it stops being usable. Both are nullable: blocks issued before this migration
 * have neither, and the service treats a block with no financial year as
 * belonging to the year it was created in, so nothing already in a device's
 * hands is invalidated by the upgrade itself.
 *
 * Expiring a block never re-issues its numbers — the series counter has already
 * moved past them. The numbers are simply burned, which is the normal cost of
 * offline blocks and far cheaper than a duplicate.
 */
export class ReservationExpiry1720000063000 implements MigrationInterface {
  name = 'ReservationExpiry1720000063000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE local_number_reservations ADD COLUMN IF NOT EXISTS financial_year varchar`);
    await queryRunner.query(`ALTER TABLE local_number_reservations ADD COLUMN IF NOT EXISTS expires_at timestamptz`);
    // The device-scoped pull pages reservations on (updated_at, id) and the
    // sweep looks for live blocks past their date; both read by device.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_local_number_reservations_device_status
         ON local_number_reservations (device_id, status)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_local_number_reservations_device_status`);
    await queryRunner.query(`ALTER TABLE local_number_reservations DROP COLUMN IF EXISTS expires_at`);
    await queryRunner.query(`ALTER TABLE local_number_reservations DROP COLUMN IF EXISTS financial_year`);
  }
}
