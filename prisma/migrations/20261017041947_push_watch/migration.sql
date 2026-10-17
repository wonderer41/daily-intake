-- CreateTable
CREATE TABLE "PushWatch" (
    "id" UUID NOT NULL,
    "repo" VARCHAR(200) NOT NULL,
    "ref" VARCHAR(300) NOT NULL,
    "branch" VARCHAR(255) NOT NULL,
    "prNumber" INTEGER,
    "prTitle" VARCHAR(300),
    "baseBranch" VARCHAR(255),
    "headSha" VARCHAR(64) NOT NULL,
    "reviewedSha" VARCHAR(64),
    "hermesRunId" VARCHAR(200),
    "runStartedAt" TIMESTAMP(3),
    "runToSha" VARCHAR(64),
    "runCommitSha" VARCHAR(64),
    "runCommittedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" VARCHAR(500),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushWatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushWatch_repo_ref_key" ON "PushWatch"("repo", "ref");

