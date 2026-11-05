---
name: generate-eson
description: Generate T24/Transact .eson record files based on reference patterns and input specifications.
---

When the user requests to generate one or more `.eson` files for specific Transact records, follow this protocol:

## 1. Input Analysis
- **CSV-based Request**: If the user provides a `.csv` file (similar to `reference_eson/export_data.csv`), parse it to extract:
  - Table/Application (e.g., `HELPTEXT.MENU`)
  - Record ID (e.g., `VMA.HLX.GROUP.CREDIT`)
  - Company Code (e.g., `AU0010001`)
- **Direct Request**: If no CSV is provided, identify the Table and Record ID from the prompt. 
  - Use the Company Code found in `reference_eson/export_data.csv` as the default if none is specified.

## 2. Understanding the ESON format
- ESON files start with one or more "use" statements which indicate the EPackage to use, via the namespace URI (nsURI) of the EPackage. This can (must) be escaped by double quotes in case of "traditional" XML like convention starting with an http:// kind of scheme, or can be without escaping in case of the "modern" more Java package like "namespace", which e.g. Xcore creates by default. Optionally, a ".*" suffix following after unquoted "use". There may be more than one "use" statement, which could be required if the EClass instances contain objects defined in another EPackage than the root object; but note that for "inferred" types of contained EClasses this is not needed.

- Next comes the name of the root EClass within that EPackage, followed by an opening "{" curly brace. Within that EObject body are listed all its features. EAttribute directly list their values. Contaiment EReference embed more EClass via "{" ... "}" etc. The type of contained objects is optional, and only required if it's a sub-type, as by default ESON will assume the type of the EReference containment. Any "multiplicity many" (i.e. Upper Bound = -1) EReferences go into pairs of "[" .. "]" - just like in JSON.

- **Use canonical capitalization**: Preserve the uppercase spelling used by Transact for application/table names, record identifiers, field names, and ESON feature names wherever applicable. Do not change the case of data values unless the source record or reference pattern uses that case; values may be case-sensitive.
- **Use ESON delimiters according to structure**: Use curly braces `{ ... }` for the root EObject and for each contained EObject. Use square brackets `[ ... ]` around collections of many-valued/repeating features, with each collection entry represented using the appropriate contained-object braces when the feature contains EObjects. Keep scalar attributes as direct values; do not wrap them in brackets. Match the actual model and reference-record structure rather than choosing delimiters by visual preference.

- Non-containment references will "refer" to EObject define elsewhere in the same or in another ESON resource. This is based on the Xtext index infrastructure.

- The name of an EObject, in order to be able to reference it from another one (or also simply for "labeling" them for clarity), by default is based on an EAttribute of type EString named "name". It is possible to customize this using the @Name annotation at the top of the ESON file, e.g. "@Name { Book = title }" (this currently has to be repeated in each ESON, not defined centrally). For convenience and readability, it is possible to put the EObject's name straight after the EClass; for example: 'Book { name: "EMF" }' === 'Book "EMF" { }'. Contained EObjects have a fully qualified name concatenated with the name of their parent container, if any.

- An example eson file for the Transact table "OVERRIDE" look like this:
```
import EB_OverrideProcessing_s.*

@Name { OVERRIDE = OVERRIDE.KEY }

OVERRIDE {
    OVERRIDE.KEY: "AA-PAY.SCH.CHANGE.RESETS.HOL"
    MESSAGE: [
        {
            MESSAGE: [
                {
                    MESSAGE: "Change in payment schedule will ignore payment holiday requests if available"
                }
            ]
            TYPE: "Auto"
            CHANNEL: ""
            APPROVE.METHOD: ""
            OVERRIDE.ACTION: ""
            RAISE.EVENT: ""
        }
    ]
    PREV.MESSAGE: [
        {
            PREV.MESSAGE: [
                {
                    PREV.MESSAGE: ""
                }
            ]
        }
    ]
    APPLICATION: [
        {
            APPLICATION: ""
            CLASS: ""
            DETAIL: ""
            DISPO: ""
            CON.OVERRIDE: [
                {
                    CON.OVERRIDE: ""
                }
            ]
            TRANSACTION.IND: ""
            PRECEDENCE: [
                {
                    PRECEDENCE: ""
                }
            ]
            DISPO.OFFICER: ""
        }
    ]
    HELP.TYPE: ""
    HELPTEXT: [
        {
            HELPTEXT: ""
        }
    ]
    LEVEL: ""
    DISPO.ALLOWED: ""
    CREATE.OVE.LIST: [
        {
            CREATE.OVE.LIST: ""
        }
    ]
    OVE.SUPPRESSION: [
        {
            OVE.SUPPRESSION: ""
        }
    ]
    EXACT.MATCH: ""
    OFS.SOURCE: [
        {
            OFS.SOURCE: ""
        }
    ]
    APP.VERSION: [
        {
            APP.VERSION: ""
            SUBROUTINE: ""
            VALIDATION: [
                {
                    VALIDATION: ""
                }
            ]
        }
    ]
    CONDITION: [
        {
            CONDITION: ""
            DATA.POSN: [
                {
                    DATA.POSN: ""
                    OPERATOR: ""
                    VALUE: ""
                    SEPARATOR: ""
                    ACTION: ""
                }
            ]
        }
    ]
    INFO: [
        {
            INFO: [
                {
                    INFO: ""
                }
            ]
        }
    ]
    SYSTEM: ""
    SUSP.APPLN: [
        {
            SUSP.APPLN: ""
            SUSP.COND.RTN: ""
            FWD.ACCT.MODE: ""
        }
    ]
    CO.CODE: "AU0010001"
}
```

## 3. Pattern Matching
- Search the `reference_eson/` directory and its subdirectories for existing `.eson` files that match the requested Table/Application.
- Analyze the structure, field names, and value types of these reference files to ensure the generated output maintains fidelity with the established ESON format.

## 4. Generation & Output
- Construct the `.eson` file following the pattern: `<CompanyCode>.<Table>!<RecordID>.data.eson`.
- **Storage**: Always save the generated files in a folder named `generated_esons` in the current working directory.
- Ensure the folder exists before writing.

## 5. Verification
- Confirm that the generated file structure matches the reference examples found in `reference_eson/`.
