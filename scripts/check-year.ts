import { resolve } from 'path'
import { readFileSync } from 'fs'
const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8')
for (const line of env.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim()
}
import { Client } from '@notionhq/client'
const notion = new Client({ auth: process.env.NOTION_TOKEN })

async function main() {
  const res = await notion.databases.query({ database_id: process.env.NOTION_REFERENCE_DB_ID as string, page_size: 3 })
  for (const page of res.results as any[]) {
    const p = page.properties
    console.log('発行年:', JSON.stringify(p['発行年']))
    console.log('ジャーナル名:', JSON.stringify(p['ジャーナル名']))
    break
  }
}
main().catch(console.error)
