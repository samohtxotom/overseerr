import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlexTitleAndPlexPassToUser1753437344000
  implements MigrationInterface
{
  name = 'AddPlexTitleAndPlexPassToUser1753437344000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" ADD "plexTitle" varchar`);
    await queryRunner.query(
      `ALTER TABLE "user" ADD "hasPlexPass" boolean NOT NULL DEFAULT (0)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "hasPlexPass"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "plexTitle"`);
  }
}
