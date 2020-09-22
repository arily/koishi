import { Server, Session, App, Context } from 'koishi-core'
import { Logger, Time } from 'koishi-utils'
import TelegramHTTPServer from './http'
import axios from 'axios'

declare module 'koishi-core/dist/server' {
  interface BotOptions {
    type?: string,
    server: string,
    url: string,
    quickOperation?: number,
  }
}

export * from './api'
export * from './http'

App.defaultConfig.quickOperation = 0.1 * Time.second

const { broadcast } = Context.prototype
const imageRE = /\[CQ:image,file=([^,]+),url=([^\]]+)\]/

Context.prototype.broadcast = async function (this: Context, ...args: any[]) {
  const index = Array.isArray(args[0]) ? 1 : 0
  let message = args[index] as string
  let output = ''
  let capture: RegExpExecArray
  // eslint-disable-next-line no-cond-assign
  while (capture = imageRE.exec(message)) {
    const [text, , url] = capture
    output += message.slice(0, capture.index)
    message = message.slice(capture.index + text.length)
    const { data } = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer' })
    output += `[CQ:image,file=base64://${Buffer.from(data).toString('base64')}]`
  }
  args[index] = output + message
  return broadcast.apply(this, args)
}

Session.prototype.$send = async function $send(this: Session, message: string, autoEscape = false) {
  if (!message) return
  let ctxId: number
  // eslint-disable-next-line no-cond-assign
  const ctxType = (ctxId = this.groupId) ? 'group' : (ctxId = this.userId) ? 'user' : null
  if (this._response) {
    const session = this.$bot.createSession(this.messageType, ctxType, ctxId, message)
    if (this.$app.bail(this, 'before-send', session)) return
    return this._response({ reply: session.message, autoEscape, atSender: false })
  }
  await this.$bot.sendGroupMsg(ctxId, message)
  return
}
