/*
  Warnings:

  - You are about to drop the column `projectId` on the `WorkCard` table. All the data in the column will be lost.
  - You are about to drop the `Project` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WorkEvent` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Workspace` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Project" DROP CONSTRAINT "Project_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "WorkCard" DROP CONSTRAINT "WorkCard_projectId_fkey";

-- DropForeignKey
ALTER TABLE "WorkEvent" DROP CONSTRAINT "WorkEvent_projectId_fkey";

-- AlterTable
ALTER TABLE "WorkCard" DROP COLUMN "projectId";

-- DropTable
DROP TABLE "Project";

-- DropTable
DROP TABLE "WorkEvent";

-- DropTable
DROP TABLE "Workspace";

-- DropEnum
DROP TYPE "EventAction";

-- DropEnum
DROP TYPE "EventSource";
