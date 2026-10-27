import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const [email, password, name] = process.argv.slice(2)

async function main() {
  if (!email || !password) {
    console.error('用法: node server/prisma/create-admin.mjs <邮箱> <密码> [姓名]')
    process.exit(1)
  }
  if (password.length < 8) {
    console.error('密码至少 8 位')
    process.exit(1)
  }

  const normalized = email.toLowerCase().trim()
  const existing = await prisma.user.findUnique({ where: { email: normalized } })

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash: bcrypt.hashSync(password, 10), role: 'admin', active: true },
    })
    console.log(`已把 ${normalized} 重置为管理员`)
    return
  }

  await prisma.user.create({
    data: {
      name: name?.trim() || normalized.split('@')[0],
      email: normalized,
      passwordHash: bcrypt.hashSync(password, 10),
      role: 'admin',
    },
  })
  console.log(`已创建管理员 ${normalized}`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })