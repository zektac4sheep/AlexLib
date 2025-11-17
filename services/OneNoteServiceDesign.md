npm install microsoft-graph-client isomorphic-fetch

Books (Notebook)
└── 作者姓名 (Section Group)
└── 書名 (Section)
├── 第 1-50 章
├── 第 51-100 章
└── ...

Summary: What You Need to DoRegister an Azure AD app → grant Notes.ReadWrite.All (delegated)
Get a long-lived refresh token (use OAuth playground or script)
Add env vars
npm install microsoft-graph-client isomorphic-fetch
Create oneNoteService.js (above code as starting point)
Add toggle in UI: sync_to_onenote: 1/0
Add background job type "onenote_sync_books"
