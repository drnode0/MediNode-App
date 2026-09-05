// 職種・経験年数・診療科（アカウント属性）API。
// GET  /api/account/profile … ログイン本人の { occupation, experienceYears, doctorDepartments }。未ログインは401。
// POST /api/account/profile … 上記を保存。occupation のみの従来リクエストも引き続き受け付ける
//   （experienceYears/doctorDepartments を省略した場合はそのフィールドを保存しない＝既存値を消さない）。
//   リスト外の値は400。未ログインは401。
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import {
  getUserProfile,
  saveUserOccupation,
  saveUserProfile,
  isValidOccupation,
  isValidExperienceYears,
} from '@/lib/account-profile'
import { CQ_DOCTOR_DEPARTMENTS } from '@/lib/cq-submit'

function ready(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

function isValidDoctorDepartmentsInput(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((d) => typeof d === 'string' && (CQ_DOCTOR_DEPARTMENTS as readonly string[]).includes(d))
}

export async function GET() {
  // Supabase未設定環境（ローカル等）では「未登録」として静かに通す。
  if (!ready()) return NextResponse.json({ occupation: null, experienceYears: null, doctorDepartments: [] })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'login_required' }, { status: 401 })
  const profile = await getUserProfile(createAdminClient(), user.id)
  // 従来の { occupation } だけを読むクライアントとの互換のため、occupation はトップレベルにも残す。
  return NextResponse.json({
    occupation: profile.occupation,
    experienceYears: profile.experienceYears,
    doctorDepartments: profile.doctorDepartments,
  })
}

export async function POST(req: NextRequest) {
  if (!ready()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'login_required' }, { status: 401 })
  let body: { occupation?: unknown; experienceYears?: unknown; doctorDepartments?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  if (!isValidOccupation(body.occupation)) {
    return NextResponse.json({ ok: false, error: 'invalid_occupation' }, { status: 400 })
  }
  // experienceYears/doctorDepartments は従来の { occupation } のみのリクエストとの互換のため任意。
  // 渡された場合だけ検証する（渡さなければ occupation のみの更新＝saveUserOccupation と同じ挙動）。
  const hasExperience = body.experienceYears !== undefined
  const hasDepartments = body.doctorDepartments !== undefined
  if (hasExperience && !isValidExperienceYears(body.experienceYears)) {
    return NextResponse.json({ ok: false, error: 'invalid_experience_years' }, { status: 400 })
  }
  if (hasDepartments && !isValidDoctorDepartmentsInput(body.doctorDepartments)) {
    return NextResponse.json({ ok: false, error: 'invalid_doctor_departments' }, { status: 400 })
  }
  try {
    const admin = createAdminClient()
    if (!hasExperience && !hasDepartments) {
      // 従来どおり occupation のみ更新（既存の experience_years/doctor_departments を消さない）。
      await saveUserOccupation(admin, user.id, body.occupation)
    } else {
      // 新規フィールドが1つでも渡されたら、既存値を保つため現在のプロフィールを先に読み、
      // 省略された側は現在値のままにする（片方だけ更新するリクエストで、もう片方をnull/[]に
      // 巻き込み消去しないため）。
      const current = await getUserProfile(admin, user.id)
      await saveUserProfile(admin, user.id, {
        occupation: body.occupation,
        experienceYears: hasExperience ? (body.experienceYears as string) : current.experienceYears || '',
        doctorDepartments: hasDepartments ? (body.doctorDepartments as string[]) : current.doctorDepartments,
      })
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500 })
  }
}
