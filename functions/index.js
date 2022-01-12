const crypto = require('crypto')
const functions = require('firebase-functions')
const admin = require('firebase-admin')
const nodemailer = require('nodemailer')
const cryptoJs = require('crypto-js')
const gmailEmail = functions.config().gmail.email
const gmailPassword = functions.config().gmail.password
const adminEmail = functions.config().admin.email
const encryptKey = functions.config().crypto.key

// Adminの初期化
admin.initializeApp()

// SMTPサーバーの設定
const mailTransport = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: gmailEmail,
    pass: gmailPassword,
  },
})

// ユーザから問い合わせ時に管理者に送るメッセージ
const adminInqueries = (data) => {
  return `お問い合わせがありました。

お名前:
${data.name}

メールアドレス:
${data.email}

件名:
${data.subject}

内容:
${data.message}

頂いたメールアドレスと内容を元に、お問い合わせ内容の回答をお願いいたします。

** 注意事項 **
・このメールは、ユーザから研究室配属希望調査を経由して、自動的に送信されたメッセージになります。
・このメールに返信をしても、ユーザが確認することができません。
・問い合わせがあったユーザに、新規でメールを作成してください。

------------------------------------------------------
同志社大学大学院 理工学研究科 情報工学専攻
同志社大学 理工学部 情報システムデザイン学科
研究室配属希望調査管理チーム
------------------------------------------------------
`
}

// TODO: Corsでエラーになるため、次回解決
// ユーザから問い合わせ時にユーザに送るメッセージ
const userInqueries = (data) => {
  return `${data.name}さん

お問合せありがとうございます。
研究室希望配属調査管理チームでございます。

以下、問い合わせ内容となります。

件名:
${data.subject}

内容:
${data.message}

こちらの内容を元に、管理チームが回答をいたしますので、しばらくお待ち下さい。
お時間を頂き、大変恐縮ですが、よろしくお願いいたします。

** 注意事項 **
・このメールは、研究室配属希望調査を経由して、自動的に送信されたメッセージになります。
・このメールに返信をしても、管理チームが確認することができません。
・管理チームからのメールが来るまで、しばらくお待ちください。

------------------------------------------------------
同志社大学大学院 理工学研究科 情報工学専攻
同志社大学 理工学部 情報システムデザイン学科
研究室配属希望調査管理チーム
------------------------------------------------------
`
}

// ユーザから問い合わせの実行
exports.sendInqueries = functions.https.onCall(async (data, context) => {
  const admin = {
    from: gmailEmail,
    to: adminEmail,
    subject: '研究室配属希望調査のお問い合わせ【' + data.name + 'さん】',
    text: adminInqueries(data),
  }

  const user = {
    from: gmailEmail,
    to: data.email,
    subject: '【研究室配属希望調査】お問い合わせの完了',
    text: userInqueries(data),
  }

  try {
    await mailTransport.sendMail(admin)
    await mailTransport.sendMail(user)
  } catch (err) {
    return err.message
  }
})

const encryptPassword = (password) => {
  return cryptoJs.AES.encrypt(password, encryptKey).toString()
}

const generatePassword = () => {
  const n = 10
  return crypto.randomBytes(n).toString('base64').substring(0, n)
}

// Excelから認証情報を追加し、DBにユーザ情報を保存
// data: Object
exports.createUserToAuthAndDB = functions.https.onCall(async (data, context) => {
  const db = admin.firestore()
  const getAuth = admin.auth()
  const res = {
    email: data.email,
    name: data.name,
  }

  // 暫定対応
  // ユーザを追加できない場合があるので、Authのユーザがあれば一旦削除する
  // Authenticationsは特に問題ないが、Cloud FireStoreに登録するデータが落ちるため、Authenticationのみを削除
  try {
    const usersById = await db.collection('users').where('id', '==', data.id).get()
    if (usersById.docs[0] == null) {
      const userRecord = await getAuth.getUserByEmail(data.email)
      if (!userRecord.uid) {
        await getAuth.deleteUser(userRecord.uid)
      }
    }
  } catch (err) {
    // eslint-disable-next-line
    console.error(err)
  }

  const pass = generatePassword()
  const authUser = {
    email: data.email,
    password: pass,
    displayName: data.name,
    emailVerified: true,
    disabled: false,
  }

  getAuth
    .createUser(authUser)
    .then((userRecord) => {
      const usersRef = db.collection('users').doc(userRecord.uid)
      const encrypt = encryptPassword(pass)
      usersRef.set({
        id: data.id,
        name: data.name,
        rank: data.rank,
        group: data.group,
        email: data.email,
        password: encrypt,
        status: data.status,
        isActive: data.isActive,
        isPointAssigned: data.isPointAssigned,
        isGraduate: data.isGraduate,
        point: data.point,
        year: data.year,
      })
      res.statusCode = 200
      return res
    })
    .catch((error) => {
      res.message = error.message
      res.statusCode = 400
      return res
    })
})

// ユーザをDBと認証情報から削除
exports.deleteUsersInAuthAndDB = functions.https.onCall(async (data, context) => {
  const db = admin.firestore()
  const getAuth = admin.auth()
  const res = {
    year: data,
  }

  const usersByYear = await db.collection('users').where('year', '==', data).get()
  usersByYear.forEach(async (user) => {
    try {
      await getAuth.deleteUser(user.id)
      await db.collection('users').doc(user.id).delete()
    } catch (err) {
      // eslint-disable-next-line
      console.error(err)
    }
  })
  return res
})
