-- DropForeignKey
ALTER TABLE "ConsentDirective" DROP CONSTRAINT "ConsentDirective_subjectId_fkey";

-- AddForeignKey
ALTER TABLE "ConsentDirective" ADD CONSTRAINT "ConsentDirective_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "RelationshipSubject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
