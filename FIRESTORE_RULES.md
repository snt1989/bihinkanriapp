# Firestore ルール（整備士アカウント対応）

整備士アカウント（管理画面で作成。ログイン時の権限が `role: "mechanic"`）は、整備に関する書き込みだけを許可します。
画面側でも操作を隠していますが、**このルールを設定すると、データベース側でも制限されます**（Firebase コンソール → Firestore Database → ルール に貼り付けて「公開」）。

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn(){ return request.auth != null; }
    function isMechanic(){ return signedIn() && request.auth.token.role == 'mechanic'; }

    // アカウント登録画面（ログイン前）が読む、社員番号の設定
    match /settings/employeeNumber {
      allow read: if true;
      allow write: if signedIn() && !isMechanic();
    }

    // 整備士が書き込めるもの：整備記録・日付コメント・備品の状態と履歴
    match /maintenance/{id}      { allow read: if signedIn(); allow write: if signedIn(); }
    match /maintDayNotes/{id}    { allow read: if signedIn(); allow write: if signedIn(); }
    match /equipmentLogs/{id}    { allow read: if signedIn(); allow write: if signedIn(); }
    match /equipment/{id} {
      allow read: if signedIn();
      allow create, delete: if signedIn() && !isMechanic();
      // 整備士は、備品の「状態」と更新日時、貸出者の欄だけ変更できる
      allow update: if signedIn() && (!isMechanic()
        || request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status','updatedAt','borrower','checkoutDate','dueDate','siteName']));
    }
    match /equipment/{id}/logs/{logId} { allow read: if signedIn(); allow write: if signedIn(); }

    // それ以外は、整備士以外のログイン済みユーザーのみ書き込める（整備士は読み取りのみ）
    match /{document=**} {
      allow read: if signedIn();
      allow write: if signedIn() && !isMechanic();
    }
  }
}
```

- 権限は、アカウントの作成（またはパスワード再設定）の時点で付き、**本人が次にログインしたとき**から有効になります。
- 管理者アカウントを含め、整備士以外は従来どおり全データを編集できます。
