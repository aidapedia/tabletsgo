-- CreateTable
CREATE TABLE "user_identities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT,
    "created_at" BIGINT NOT NULL,
    "last_used_at" BIGINT
);

-- CreateIndex
CREATE UNIQUE INDEX "idx_user_identities_subject" ON "user_identities"("provider", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "idx_user_identities_user" ON "user_identities"("user_id", "provider");
