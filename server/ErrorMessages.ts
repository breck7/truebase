const { Utils } = require("jtree/products/Utils.js")

const UserFacingWarningMessages = {
  noFiles: (folderName: string) => `No files found in '${folderName}' folder`,
  noFilesWithRightExtension: (extName: string) => `No files found with extension '${extName}'.`
}

const UserFacingErrorMessages = {
  brokenPermalink: (subjectId: string, targetId: string) => `Broken permalink in '${subjectId}': No file '${targetId}' found`,
  missingColumnSourceFile: (filePath: string) => `Could not find grammar file '${filePath}'`,
  missingColumn: (colName: string, allColumnNames: string[]) => `No column found for '${colName}'. Available columns: ${allColumnNames.sort().join(" ")}`,
  titleRequired: (content: string) => `A "title" must be provided when creating a new file. Content provided:\n ${content.replace(/\n/g, "\n ")}`,
  duplicateId: (id: string) => `Already file with id: "${id}". Are you sure the database doesn't have this already? Perhaps update the title to something more unique for now.`,
  returnCharFound: (fullPath: string) => `Return character '\\r' found in '${fullPath}'. Return chars are unneeded.`,
  invalidEmail: (email: string) => `Invalid email: "${Utils.htmlEscaped(email)}"`,
  fileNotFound: (id: string) => `File '${id}' not found.`,
  patchSizeTooLarge: (actual: number, limit: number) => `Submission of ${actual} bytes greater than limit of ${limit} bytes. Please submit changes through a Git pull request.`,
  tooManyErrors: (actual: number, allowed: number, errs: any[]) =>
    `Too many errors. ${actual} errors detected, which exceeds the allowed limit of ${allowed}. Please fix and retry or submit changes through a Pull Request. Errors: ${JSON.stringify(errs.map((err: any) => err.toObject()))}`,
  notEnoughFacts: (actual: number, expected: number) => `Not enough data provided. ${actual} facts provided, which is less than the minimum ${expected}.`
}

export { UserFacingWarningMessages, UserFacingErrorMessages }
