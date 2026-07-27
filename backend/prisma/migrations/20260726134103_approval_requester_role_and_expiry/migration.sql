-- AlterEnum
ALTER TYPE "ApprovalStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "AgentApproval" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "requesterRole" "Role";
