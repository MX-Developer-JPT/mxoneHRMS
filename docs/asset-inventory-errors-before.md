# Inventory Management & Asset Tracking - editor/type-check errors (before the fix)

Source: `tsc -p maxvolt-hr/jsconfig.json --noEmit` (the project type-checks JavaScript via `checkJs`; this is what the editor's Problems pane shows).

Total: **243** errors - pages/AssetTracking.jsx 230, pages/MyAssets.jsx 13.

## Summary by cause

| Cause | Count |
|---|---|
| UI component props not typed (Card/Button/Table/Select... inferred as ref-only) | 184 |
| base44.entities typed as {} (shared client has no types) | 26 |
| UI component required props (variant/className) wrongly required (Badge/Button) | 12 |
| Property used but missing from the object/state type (asset form fields) | 8 |
| Form state literal has fields the initial state type lacks | 5 |
| Other | 5 |
| Wrong argument type (Date passed where a number is expected) | 2 |
| UI component required props wrongly required | 1 |

## Every error


### UI component props not typed (Card/Button/Table/Select... inferred as ref-only) (184)

- `AssetTracking.jsx(1011,14): error TS2322: Type '{ children: (string | Element)[]; variant: string; onClick: () => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1012,14): error TS2322: Type '{ children: (string | Element)[]; variant: string; onClick: () => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1013,14): error TS2322: Type '{ children: (string | Element)[]; variant: string; onClick: () => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1014,14): error TS2322: Type '{ children: (string | Element)[]; variant: string; onClick: () => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1015,14): error TS2322: Type '{ children: (string | Element)[]; onClick: () => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1028,14): error TS2322: Type '{ children: Element; key: string; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1029,16): error TS2322: Type '{ children: Element[]; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1039,12): error TS2322: Type '{ children: Element[]; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1040,14): error TS2322: Type '{ children: Element; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1041,16): error TS2322: Type '{ children: (string | number | Element)[]; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1045,14): error TS2559: Type '{ children: Element; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1060,10): error TS2559: Type '{ children: Element[]; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1061,12): error TS2322: Type '{ children: Element[]; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1062,14): error TS2322: Type '{ children: string; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1066,17): error TS2322: Type '{ className: string; placeholder: string; value: string; onChange: (e: any) => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1073,12): error TS2559: Type '{ children: Element; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1090,20): error TS2322: Type '{ children: Element; key: any; className: string; onClick: () => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1091,22): error TS2322: Type '{ children: Element[]; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1118,26): error TS2322: Type '{ children: (string | Element)[]; size: string; variant: string; className: string; onClick: (e: any) => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1121,26): error TS2322: Type '{ children: Element; size: string; variant: string; className: string; onClick: (e: any) => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1130,16): error TS2322: Type '{ children: Element; className: string; onClick: () => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1131,18): error TS2322: Type '{ children: Element[]; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1150,14): error TS2559: Type '{ children: Element[]; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1151,16): error TS2322: Type '{ children: Element; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1152,18): error TS2322: Type '{ children: (string | Element)[]; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1157,16): error TS2559: Type '{ children: Element; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1162,24): error TS2322: Type '{ children: Element; key: string; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1163,26): error TS2322: Type '{ children: Element[]; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1180,28): error TS2322: Type '{ children: (string | Element)[]; size: string; variant: string; className: string; onClick: () => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1194,10): error TS2559: Type '{ children: Element[]; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1195,12): error TS2322: Type '{ children: Element; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1197,16): error TS2322: Type '{ children: (string | Element)[]; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1200,22): error TS2322: Type '{ children: Element; variant: string; size: string; onClick: () => void; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1211,26): error TS2322: Type '{ className: string; placeholder: string; value: string; onChange: (e: any) => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1214,20): error TS2322: Type '{ children: Element; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1215,20): error TS2559: Type '{ children: Element[]; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1216,22): error TS2322: Type '{ children: string; value: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1217,22): error TS2322: Type '{ children: string; value: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1218,22): error TS2322: Type '{ children: string; value: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1219,22): error TS2322: Type '{ children: string; value: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1220,22): error TS2322: Type '{ children: string; value: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1221,22): error TS2322: Type '{ children: string; value: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1225,20): error TS2322: Type '{ children: any[]; size: string; onClick: () => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1230,20): error TS2322: Type '{ children: string; size: string; variant: string; className: string; onClick: () => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1237,12): error TS2559: Type '{ children: Element[]; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1251,20): error TS2322: Type '{ children: Element; className: string; align: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1252,22): error TS2559: Type '{ children: Element[]; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1253,37): error TS2322: Type '{ placeholder: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1254,24): error TS2559: Type '{ children: Element[]; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1255,26): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1256,26): error TS2559: Type '{ children: (Element | Element[])[]; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1257,28): error TS2322: Type '{ children: (string | Element)[]; value: string; onSelect: () => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1261,30): error TS2322: Type '{ children: any[]; key: any; value: string; onSelect: () => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1271,18): error TS2322: Type '{ children: (string | Element)[]; size: string; disabled: boolean; onClick: () => Promise<void>; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1275,18): error TS2322: Type '{ children: string; size: string; variant: string; onClick: () => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1319,30): error TS2322: Type '{ children: (string | Element)[]; size: string; variant: string; className: string; onClick: () => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1322,30): error TS2322: Type '{ children: (string | Element)[]; size: string; variant: string; className: string; onClick: () => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1325,30): error TS2322: Type '{ children: Element; size: string; variant: string; className: string; onClick: () => Promise<void>; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1337,30): error TS2322: Type '{ children: Element; className: string; align: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1338,32): error TS2559: Type '{ children: Element[]; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1339,47): error TS2322: Type '{ placeholder: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1340,34): error TS2559: Type '{ children: Element[]; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1341,36): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1342,36): error TS2559: Type '{ children: (Element | Element[])[]; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1343,38): error TS2322: Type '{ children: string; value: string; onSelect: () => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1347,40): error TS2322: Type '{ children: any; key: any; value: string; onSelect: () => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1357,26): error TS2322: Type '{ children: Element; size: string; variant: string; className: string; onClick: () => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1358,26): error TS2322: Type '{ children: Element; size: string; variant: string; className: string; onClick: () => Promise<void>; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1369,10): error TS2559: Type '{ children: Element[]; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1370,12): error TS2322: Type '{ children: Element; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1372,16): error TS2322: Type '{ children: (string | Element)[]; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1376,18): error TS2322: Type '{ children: Element; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1377,18): error TS2559: Type '{ children: Element[]; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1378,37): error TS2322: Type '{ children: any[]; key: any; value: any; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1383,12): error TS2559: Type '{ children: Element; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1411,26): error TS2322: Type '{ children: Element; size: string; variant: string; className: string; onClick: () => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1412,26): error TS2322: Type '{ children: Element; size: string; variant: string; className: string; onClick: () => Promise<void>; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1429,10): error TS2322: Type '{ children: Element[]; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1430,26): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1434,18): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1441,22): error TS2559: Type '{ children: Element; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1442,22): error TS2559: Type '{ children: Element[]; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1444,26): error TS2322: Type '{ children: any[]; key: any; value: any; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1451,18): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1452,24): error TS2322: Type '{ value: string; onChange: (e: any) => void; placeholder: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1454,21): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1454,50): error TS2322: Type '{ value: any; onChange: (e: any) => void; placeholder: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1455,21): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1455,54): error TS2322: Type '{ value: string; onChange: (e: any) => void; placeholder: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1456,21): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1456,55): error TS2322: Type '{ value: string; onChange: (e: any) => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1457,21): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1457,55): error TS2322: Type '{ value: string; onChange: (e: any) => void; placeholder: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1458,21): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1458,53): error TS2322: Type '{ value: string; onChange: (e: any) => void; placeholder: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1459,21): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1461,20): error TS2559: Type '{ children: Element; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1462,20): error TS2559: Type '{ children: Element[]; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1463,71): error TS2322: Type '{ children: string; key: string; value: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1467,21): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1477,20): error TS2322: Type '{ children: Element; className: string; align: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1478,22): error TS2559: Type '{ children: Element[]; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1479,37): error TS2322: Type '{ placeholder: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1480,24): error TS2559: Type '{ children: Element[]; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1481,26): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1482,26): error TS2559: Type '{ children: (Element | Element[])[]; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1483,28): error TS2322: Type '{ children: (string | Element)[]; value: string; onSelect: () => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1486,28): error TS2322: Type '{ children: (string | Element)[]; value: string; onSelect: () => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1490,30): error TS2322: Type '{ children: any[]; key: any; value: string; onSelect: () => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1501,21): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1501,57): error TS2322: Type '{ type: string; value: string; onChange: (e: any) => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1502,21): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1502,53): error TS2322: Type '{ type: string; value: string; onChange: (e: any) => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1509,26): error TS2322: Type '{ className: string; placeholder: string; value: any; onChange: (e: any) => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1512,21): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1512,55): error TS2322: Type '{ type: string; value: string; onChange: (e: any) => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1513,21): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1513,59): error TS2322: Type '{ type: string; value: string; onChange: (e: any) => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1514,21): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1514,57): error TS2322: Type '{ type: string; value: string; onChange: (e: any) => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1516,19): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1516,48): error TS2322: Type '{ value: string; onChange: (e: any) => void; rows: number; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1517,14): error TS2322: Type '{ children: (string | Element)[]; onClick: () => Promise<void>; disabled: boolean; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1527,10): error TS2322: Type '{ children: Element[]; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1528,26): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1535,16): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1537,18): error TS2559: Type '{ children: Element; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1538,18): error TS2559: Type '{ children: Element[]; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1539,69): error TS2322: Type '{ children: string; key: string; value: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1544,16): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1545,22): error TS2322: Type '{ type: string; value: string; onChange: (e: any) => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1548,16): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1549,25): error TS2322: Type '{ value: string; onChange: (e: any) => void; rows: number; placeholder: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1551,14): error TS2322: Type '{ children: (string | Element)[]; onClick: () => Promise<void>; disabled: boolean; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1561,10): error TS2322: Type '{ children: Element[]; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1562,26): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1571,18): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1573,20): error TS2559: Type '{ children: Element; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1574,20): error TS2559: Type '{ children: Element[]; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1576,24): error TS2322: Type '{ children: string; key: string; value: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1582,18): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1584,20): error TS2559: Type '{ children: Element; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1585,20): error TS2559: Type '{ children: Element[]; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1587,24): error TS2322: Type '{ children: string; key: string; value: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1592,21): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1592,56): error TS2322: Type '{ type: string; value: string; onChange: (e: any) => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1593,21): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1593,57): error TS2322: Type '{ type: string; value: string; onChange: (e: any) => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1594,21): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1594,50): error TS2322: Type '{ type: string; value: string; onChange: (e: any) => void; placeholder: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1595,21): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1595,53): error TS2322: Type '{ value: string; onChange: (e: any) => void; placeholder: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1599,16): error TS2322: Type '{ children: string; htmlFor: string; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1601,19): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1601,54): error TS2322: Type '{ value: string; onChange: (e: any) => void; rows: number; placeholder: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1602,19): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1602,54): error TS2322: Type '{ value: string; onChange: (e: any) => void; placeholder: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1603,19): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1603,59): error TS2322: Type '{ value: string; onChange: (e: any) => void; rows: number; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1604,14): error TS2322: Type '{ children: (string | Element)[]; onClick: () => Promise<void>; disabled: boolean; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1614,10): error TS2322: Type '{ children: Element[]; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1615,26): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1626,18): error TS2322: Type '{ children: (string | Element)[]; type: string; variant: string; size: string; className: string; onClick: () => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1635,24): error TS2322: Type '{ children: string; size: string; variant: string; onClick: () => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1658,18): error TS2322: Type '{ children: string; variant: string; className: string; onClick: () => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1664,16): error TS2322: Type '{ children: (string | Element)[]; onClick: () => Promise<void>; disabled: boolean; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1675,10): error TS2322: Type '{ children: Element[]; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1676,26): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1678,19): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1678,46): error TS2322: Type '{ value: string; onChange: (e: any) => void; placeholder: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1679,19): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1679,46): error TS2322: Type '{ value: string; onChange: (e: any) => void; placeholder: string; maxLength: number; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1681,16): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1701,19): error TS2559: Type '{ children: string; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1701,54): error TS2322: Type '{ value: string; onChange: (e: any) => void; rows: number; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1703,16): error TS2322: Type '{ children: (string | Element)[]; onClick: () => Promise<void>; disabled: boolean; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `AssetTracking.jsx(1708,18): error TS2322: Type '{ children: Element; variant: string; onClick: () => Promise<void>; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `MyAssets.jsx(199,14): error TS2322: Type '{ children: (string | number | Element)[]; variant: string; size: string; onClick: () => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `MyAssets.jsx(206,12): error TS2559: Type '{ children: Element; }' has no properties in common with type 'IntrinsicAttributes & RefAttributes<any>'.`
- `MyAssets.jsx(207,14): error TS2322: Type '{ children: Element[]; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `MyAssets.jsx(219,18): error TS2322: Type '{ children: Element; key: any; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `MyAssets.jsx(220,20): error TS2322: Type '{ children: Element; className: string; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `MyAssets.jsx(252,26): error TS2322: Type '{ children: (string | Element)[]; size: string; variant: string; onClick: () => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`
- `MyAssets.jsx(256,28): error TS2322: Type '{ children: (string | Element)[]; size: string; variant: string; className: string; onClick: () => void; }' is not assignable to type 'IntrinsicAttributes & RefAttributes<any>'.`

### base44.entities typed as {} (shared client has no types) (26)

- `AssetTracking.jsx(146,25): error TS2339: Property 'Asset' does not exist on type '{}'.`
- `AssetTracking.jsx(147,25): error TS2339: Property 'AssetType' does not exist on type '{}'.`
- `AssetTracking.jsx(148,25): error TS2339: Property 'Employee' does not exist on type '{}'.`
- `AssetTracking.jsx(149,25): error TS2339: Property 'MaintenanceLog' does not exist on type '{}'.`
- `AssetTracking.jsx(150,25): error TS2339: Property 'AssetActivityLog' does not exist on type '{}'.`
- `AssetTracking.jsx(151,25): error TS2339: Property 'User' does not exist on type '{}'.`
- `AssetTracking.jsx(251,31): error TS2339: Property 'AssetType' does not exist on type '{}'.`
- `AssetTracking.jsx(254,31): error TS2339: Property 'AssetType' does not exist on type '{}'.`
- `AssetTracking.jsx(270,27): error TS2339: Property 'AssetType' does not exist on type '{}'.`
- `AssetTracking.jsx(345,31): error TS2339: Property 'Asset' does not exist on type '{}'.`
- `AssetTracking.jsx(348,31): error TS2339: Property 'Asset' does not exist on type '{}'.`
- `AssetTracking.jsx(359,27): error TS2339: Property 'Asset' does not exist on type '{}'.`
- `AssetTracking.jsx(369,29): error TS2339: Property 'Asset' does not exist on type '{}'.`
- `AssetTracking.jsx(389,29): error TS2339: Property 'Asset' does not exist on type '{}'.`
- `AssetTracking.jsx(410,29): error TS2339: Property 'Asset' does not exist on type '{}'.`
- `AssetTracking.jsx(449,25): error TS2339: Property 'Asset' does not exist on type '{}'.`
- `AssetTracking.jsx(636,31): error TS2339: Property 'MaintenanceLog' does not exist on type '{}'.`
- `AssetTracking.jsx(639,31): error TS2339: Property 'MaintenanceLog' does not exist on type '{}'.`
- `AssetTracking.jsx(644,31): error TS2339: Property 'Asset' does not exist on type '{}'.`
- `AssetTracking.jsx(647,31): error TS2339: Property 'Asset' does not exist on type '{}'.`
- `AssetTracking.jsx(657,27): error TS2339: Property 'MaintenanceLog' does not exist on type '{}'.`
- `AssetTracking.jsx(851,47): error TS2339: Property 'AssetType' does not exist on type '{}'.`
- `AssetTracking.jsx(912,35): error TS2339: Property 'Asset' does not exist on type '{}'.`
- `MyAssets.jsx(43,25): error TS2339: Property 'Asset' does not exist on type '{}'.`
- `MyAssets.jsx(44,25): error TS2339: Property 'AssetType' does not exist on type '{}'.`
- `MyAssets.jsx(45,25): error TS2339: Property 'Employee' does not exist on type '{}'.`

### UI component required props (variant/className) wrongly required (Badge/Button) (12)

- `AssetTracking.jsx(1051,22): error TS2741: Property 'variant' is missing in type '{ children: string[]; className: string; }' but required in type '{ [x: string]: any; className: any; variant: any; }'.`
- `AssetTracking.jsx(1176,53): error TS2741: Property 'variant' is missing in type '{ children: string; className: string; }' but required in type '{ [x: string]: any; className: any; variant: any; }'.`
- `AssetTracking.jsx(1296,30): error TS2741: Property 'variant' is missing in type '{ children: any; className: any; }' but required in type '{ [x: string]: any; className: any; variant: any; }'.`
- `AssetTracking.jsx(1297,30): error TS2741: Property 'variant' is missing in type '{ children: any; className: any; }' but required in type '{ [x: string]: any; className: any; variant: any; }'.`
- `AssetTracking.jsx(1308,46): error TS2741: Property 'variant' is missing in type '{ children: string; className: string; }' but required in type '{ [x: string]: any; className: any; variant: any; }'.`
- `AssetTracking.jsx(1315,28): error TS2741: Property 'variant' is missing in type '{ children: (string | Element)[]; className: string; }' but required in type '{ [x: string]: any; className: any; variant: any; }'.`
- `AssetTracking.jsx(1397,30): error TS2741: Property 'variant' is missing in type '{ children: any; className: any; }' but required in type '{ [x: string]: any; className: any; variant: any; }'.`
- `AssetTracking.jsx(1398,30): error TS2741: Property 'variant' is missing in type '{ children: any; className: any; }' but required in type '{ [x: string]: any; className: any; variant: any; }'.`
- `AssetTracking.jsx(1399,55): error TS2741: Property 'variant' is missing in type '{ children: string; className: string; }' but required in type '{ [x: string]: any; className: any; variant: any; }'.`
- `MyAssets.jsx(229,30): error TS2741: Property 'variant' is missing in type '{ children: string; className: any; }' but required in type '{ [x: string]: any; className: any; variant: any; }'.`
- `MyAssets.jsx(230,53): error TS2741: Property 'variant' is missing in type '{ children: (string | Element)[]; className: string; }' but required in type '{ [x: string]: any; className: any; variant: any; }'.`
- `MyAssets.jsx(231,44): error TS2741: Property 'variant' is missing in type '{ children: (string | Element)[]; className: string; }' but required in type '{ [x: string]: any; className: any; variant: any; }'.`

### Property used but missing from the object/state type (asset form fields) (8)

- `AssetTracking.jsx(322,15): error TS2339: Property 'asset_id' does not exist on type '{ asset_type_id: any; asset_name: string; serial_number: string; model_number: string; specification: string; accessories: string; assigned_to_user_id: string; assignment_date: string; return_date: string; ... 5 mor`
- `AssetTracking.jsx(338,34): error TS2339: Property 'asset_id' does not exist on type '{ purchase_cost: number; asset_type_name: any; asset_name: string; asset_type_id: string; serial_number: string; model_number: string; specification: string; accessories: string; assigned_to_user_id: string; ... 6 m`
- `AssetTracking.jsx(339,14): error TS2339: Property 'asset_id' does not exist on type '{ purchase_cost: number; asset_type_name: any; asset_name: string; asset_type_id: string; serial_number: string; model_number: string; specification: string; accessories: string; assigned_to_user_id: string; ... 6 m`
- `AssetTracking.jsx(911,18): error TS2339: Property 'asset_id' does not exist on type '{ assigned_to_user_id?: any; assignment_date?: string; asset_name: any; asset_type_id: any; asset_type_name: any; serial_number: string; model_number: string; condition: string; purchase_date: string; purchase_cost:`
- `AssetTracking.jsx(1454,67): error TS2339: Property 'asset_id' does not exist on type '{ asset_name: string; asset_type_id: string; serial_number: string; model_number: string; specification: string; accessories: string; assigned_to_user_id: string; assignment_date: string; ... 6 more ...; notes: str`
- `AssetTracking.jsx(1505,61): error TS2339: Property 'is_temporary' does not exist on type '{ asset_name: string; asset_type_id: string; serial_number: string; model_number: string; specification: string; accessories: string; assigned_to_user_id: string; assignment_date: string; ... 6 more ...; notes:`
- `AssetTracking.jsx(1508,28): error TS2339: Property 'is_temporary' does not exist on type '{ asset_name: string; asset_type_id: string; serial_number: string; model_number: string; specification: string; accessories: string; assigned_to_user_id: string; assignment_date: string; ... 6 more ...; notes:`
- `AssetTracking.jsx(1509,113): error TS2339: Property 'temporary_reason' does not exist on type '{ asset_name: string; asset_type_id: string; serial_number: string; model_number: string; specification: string; accessories: string; assigned_to_user_id: string; assignment_date: string; ... 6 more ...; n`

### Form state literal has fields the initial state type lacks (5)

- `AssetTracking.jsx(297,7): error TS2353: Object literal may only specify known properties, and 'is_temporary' does not exist in type 'SetStateAction<{ asset_name: string; asset_type_id: string; serial_number: string; model_number: string; specification: string; accessories: string; assigned_to_user_i`
- `AssetTracking.jsx(313,7): error TS2353: Object literal may only specify known properties, and 'is_temporary' does not exist in type 'SetStateAction<{ asset_name: string; asset_type_id: string; serial_number: string; model_number: string; specification: string; accessories: string; assigned_to_user_i`
- `AssetTracking.jsx(1454,120): error TS2353: Object literal may only specify known properties, and 'asset_id' does not exist in type 'SetStateAction<{ asset_name: string; asset_type_id: string; serial_number: string; model_number: string; specification: string; accessories: string; assigned_to_user_id`
- `AssetTracking.jsx(1505,118): error TS2353: Object literal may only specify known properties, and 'is_temporary' does not exist in type 'SetStateAction<{ asset_name: string; asset_type_id: string; serial_number: string; model_number: string; specification: string; accessories: string; assigned_to_use`
- `AssetTracking.jsx(1509,180): error TS2353: Object literal may only specify known properties, and 'temporary_reason' does not exist in type 'SetStateAction<{ asset_name: string; asset_type_id: string; serial_number: string; model_number: string; specification: string; accessories: string; assigned_to`

### Other (5)

- `AssetTracking.jsx(1430,12): error TS2741: Property 'className' is missing in type '{ children: Element; }' but required in type '{ [x: string]: any; className: any; }'.`
- `AssetTracking.jsx(1528,12): error TS2741: Property 'className' is missing in type '{ children: Element; }' but required in type '{ [x: string]: any; className: any; }'.`
- `AssetTracking.jsx(1562,12): error TS2741: Property 'className' is missing in type '{ children: Element; }' but required in type '{ [x: string]: any; className: any; }'.`
- `AssetTracking.jsx(1615,12): error TS2741: Property 'className' is missing in type '{ children: Element; }' but required in type '{ [x: string]: any; className: any; }'.`
- `AssetTracking.jsx(1676,12): error TS2741: Property 'className' is missing in type '{ children: Element; }' but required in type '{ [x: string]: any; className: any; }'.`

### Wrong argument type (Date passed where a number is expected) (2)

- `AssetTracking.jsx(752,41): error TS2345: Argument of type 'Date' is not assignable to parameter of type 'number'.`
- `AssetTracking.jsx(755,20): error TS2345: Argument of type 'Date' is not assignable to parameter of type 'number'.`

### UI component required props wrongly required (1)

- `AssetTracking.jsx(1169,30): error TS2739: Type '{ children: any[]; }' is missing the following properties from type '{ [x: string]: any; className: any; variant: any; }': className, variant`

---

## After the fix

| | Before | After |
|---|---|---|
| Type errors in `AssetTracking.jsx` | 230 | **0** |
| Type errors in `MyAssets.jsx` | 13 | **0** |
| Type errors in `components/assets/*` | not checked | **0** (now included in the check) |
| ESLint errors in the module | 10 | **0** |
| Type errors in the whole app | 7,651 | 1,030 (the rest are in other modules) |

### What was changed
1. **UI component typing (184 + 13 errors here, ~6,500 app-wide)** — the shadcn components are untyped JS, so every `<Card>`, `<Button>`, `<Badge variant>`, `<Select>`… was flagged. `scripts/gen-ui-types.mjs` generates loose stubs in `src/types/ui/` and `jsconfig.json` maps `@/components/ui/*` to them (editor only; Vite still bundles the real components). Re-run with `npm run types:ui` after adding a component.
2. **`base44.entities.X does not exist on type {}` (26 errors here, ~640 app-wide)** — `src/api/base44Client.js` now declares `entities` as `Record<string, any>`.
3. **Asset form state (13 errors)** — `asset_id`, `is_temporary`, `temporary_reason` were used by the dialog but missing from the form state. That was also a real bug: the *Asset ID* box was an uncontrolled input, showed blank when editing an existing asset, and a new asset's generated ID was thrown away.
4. **Wrong argument type (2)** — `isNaN(date)` in the Excel importer → `isNaN(date.getTime())`.
5. **Real behaviour bugs fixed while there**
   - Editing a *signed* asset silently reset it to *assigned* (lost the employee's acknowledgement).
   - Two assets could be saved with the same Asset ID.
   - Deleting an asset / asset type had no error handling (a failed delete was an unhandled rejection).
   - Any empty/malformed date (common after Excel imports) made `format(parseISO(...))` throw and blank the page; all asset date handling now goes through `src/lib/assetDates.js` (never throws).
   - An overdue-return badge rendered a `<div>` inside a `<p>` (React DOM-nesting error on every render).
   - Unused imports/variables (10 ESLint errors) removed.
