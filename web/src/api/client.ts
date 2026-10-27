import axios, { AxiosError } from 'axios'

export const http = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 60_000,
})

export class ApiError extends Error {
  readonly status: number
  readonly details: unknown

  constructor(status: number, message: string, details: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

function extractMessage(error: AxiosError): string {
  const data = error.response?.data as { message?: string | string[] } | undefined
  const message = data?.message
  if (Array.isArray(message)) return message.join('；')
  if (typeof message === 'string' && message) return message
  if (error.code === 'ECONNABORTED') return '请求超时，请稍后重试'
  if (!error.response) return '无法连接服务器，请检查网络'
  return '请求失败'
}

http.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const status = error.response?.status ?? 0
    throw new ApiError(status, extractMessage(error), error.response?.data)
  },
)