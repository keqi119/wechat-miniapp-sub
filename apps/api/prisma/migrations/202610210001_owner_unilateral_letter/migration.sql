ALTER TABLE "OwnerAutoAuthority" ADD COLUMN "method" TEXT NOT NULL DEFAULT 'PROVIDER_AUTO_GRANT';
CREATE TABLE "OwnerAuthorizationLetter" (
 "authorityId" TEXT NOT NULL,
 "state" TEXT NOT NULL DEFAULT 'DRAFT',
 "snapshot" JSONB NOT NULL,
 "bodyHash" TEXT NOT NULL,
 "sourceFileId" TEXT,
 "sourceSha256" TEXT,
 "slotCoordinates" JSONB,
 "uploadedAt" TIMESTAMP(3),
 "signIssuedAt" TIMESTAMP(3),
 "signedAt" TIMESTAMP(3),
 "signedFileId" TEXT,
 "signedPdfHash" TEXT,
 "queryEvidenceHash" TEXT,
 "withdrawnAt" TIMESTAMP(3),
 "processingToken" TEXT,
 "processingUntil" TIMESTAMP(3),
 "lastErrorCode" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "OwnerAuthorizationLetter_pkey" PRIMARY KEY ("authorityId"),
 CONSTRAINT "OwnerAuthorizationLetter_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "OwnerAutoAuthority"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
