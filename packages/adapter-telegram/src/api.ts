import { camelCase, Logger, snakeCase, capitalize, CQCode } from 'koishi-utils'
import { Bot, AccountInfo, SenderInfo, StatusInfo, StrangerInfo, BotStatusCode } from 'koishi-core'

const logger = new Logger('bot')

export class SenderError extends Error {
  constructor(args: Record<string, any>, url: string, retcode: number, selfId: number) {
    super(`Error when trying to send to ${url}, args: ${JSON.stringify(args)}, retcode: ${retcode}`)
    Object.defineProperties(this, {
      name: { value: 'SenderError' },
      selfId: { value: selfId },
      code: { value: retcode },
      args: { value: args },
      url: { value: url },
    })
  }
}

export interface CQResponse {
  status: string
  retcode: number
  data: any
  echo?: number
}

interface MessageResponse {
  messageId: number
}

export type RecordFormat = 'mp3' | 'amr' | 'wma' | 'm4a' | 'spx' | 'ogg' | 'wav' | 'flac'

export interface FriendInfo extends AccountInfo {
  remark: string
}

export interface ListedGroupInfo {
  groupId: number
  groupName: string
}

export interface GroupInfo extends ListedGroupInfo {
  memberCount: number
  maxMemberCount: number
}

export interface GroupMemberInfo extends SenderInfo {
  cardChangeable: boolean
  groupId: number
  joinTime: number
  lastSentTime: number
  titleExpireTime: number
  unfriendly: boolean
}

declare module 'koishi-core/dist/server' {
  interface Bot {
    _request?(action: string, params: Record<string, any>): Promise<CQResponse>
    _sendMsg(groupId: string | number, message: string): Promise<any>
    _sendPhoto(userId: string | number, caption: string, photo: string): Promise<any>
    get<T = any>(action: string, params?: Record<string, any>, silent?: boolean): Promise<T>
    sendMsg(chatId: string | number, message: string): Promise<number>
    deleteMsg(messageId: number): Promise<void>
    getLoginInfo(): Promise<AccountInfo>
    getFriendList(): Promise<FriendInfo[]>
    getGroupList(): Promise<ListedGroupInfo[]>
    setGroupLeave(chatId: string | number): Promise<boolean>
    getGroupInfo(groupId: number, noCache?: boolean): Promise<GroupInfo>
    getGroupMemberInfo(groupId: number, userId: number, noCache?: boolean): Promise<GroupMemberInfo>
    getGroupMemberList(groupId: number): Promise<GroupMemberInfo[]>
  }
}

Bot.prototype.get = async function (this: Bot, action, params = {}, silent = false) {
  logger.debug('[request] %s %o', action, params)
  const response = await this._request(action, snakeCase(params))
  logger.debug('[response] %o', response)
  const { data, retcode } = response
  if (retcode === 0 && !silent) {
    return camelCase(data)
  } else if (retcode < 0 && !silent) {
    throw new SenderError(params, action, retcode, this.selfId)
  } else if (retcode > 1) {
    throw new SenderError(params, action, retcode, this.selfId)
  }
}

Bot.prototype._sendMsg = async function (this: Bot, chatId, message) {
  if (!message) return
  await this.get<MessageResponse>('send_message', { chatId, message });
}

Bot.prototype._sendPhoto = async function (this: Bot, chatId, caption, photo) {
  if (!photo) return
  await this.get<MessageResponse>('send_photo', { chatId, caption, photo });
}

Bot.prototype.sendMsg = async function (this: Bot, chatId, message) {
  const chain = CQCode.parseAll(message);
  const payload = { chatId, message: '', image: '' };
  let result;
  for (const node of chain) {
    if (typeof node === 'string') {
      payload.message += node;
    } else if (node.type === 'image') {
      if (payload.image) {
        result = await this._sendPhoto(chatId, payload.message, payload.image); // Flush
        payload.message = '';
        payload.image = '';
      }
      payload.image = node.data.url;
    }
  }
  if (payload.image) {
    result = await this._sendPhoto(chatId, payload.message, payload.image); // Flush
    payload.message = '';
    payload.image = '';
  } else if (payload.message) {
    result = await this._sendMsg(chatId, payload.message);
  }
  return result.messageId;
}

Bot.prototype.sendGroupMsg = async function (this: Bot, chatId, message, _autoEscape) {
  if (!message) return
  const session = this.createSession('group', 'group', chatId, message)
  if (this.app.bail(session, 'before-send', session)) return
  session.messageId = await this.sendMsg(chatId, session.message);
  this.app.emit(session, 'send', session)
  return session.messageId
}

Bot.prototype.sendPrivateMsg = async function (this: Bot, userId, message, autoEscape = false) {
  if (!message) return
  const session = this.createSession('private', 'user', userId, message)
  if (this.app.bail(session, 'before-send', session)) return
  session.messageId = await this.sendMsg(userId, session.message);
  this.app.emit(session, 'send', session)
  return session.messageId;
}

Bot.prototype.getSelfId = async function getSelfId(this: Bot) {
  const { id } = await this.get('getMe');
  return id
}

Bot.prototype.getStatusCode = async function getStatusCode(this: Bot) {
  if (!this.ready) return BotStatusCode.BOT_IDLE
  try {
    await this.get('getMe');
    return BotStatusCode.GOOD
  } catch {
    return BotStatusCode.NET_ERROR
  }
}

Bot.prototype.setGroupLeave = async function setGroupLeave(this: Bot, chatId: string | number) {
  return this.get('leave_chat', { chatId });
}

function defineSync(name: string, ...params: string[]) {
  const prop = camelCase(name.replace(/^_/, ''))
  Bot.prototype[prop] = function (this: Bot, ...args: any[]) {
    return this.get(name, Object.fromEntries(params.map((name, index) => [name, args[index]])))
  }
}

function defineReturn(name: string, value: any) {
  const prop = camelCase(name.replace(/^_/, ''))
  Bot.prototype[prop] = async function (this: Bot) {
    return value
  }
}

defineSync('delete_msg', 'message_id')
defineSync('get_login_info')
defineSync('get_group_info', 'group_id', 'no_cache')
defineSync('get_group_member_info', 'group_id', 'user_id', 'no_cache')
defineSync('get_group_member_list', 'group_id')
defineReturn('can_send_image', true)
defineReturn('can_send_record', true)
defineReturn('get_group_list', [])
defineReturn('get_friend_list', [])

// go-cqhttp extension

export interface GroupMessage {
  messageId: number
  realId: number
  sender: AccountInfo
  time: number
  content: string
}

export interface ForwardMessage {
  messages: {
    sender: AccountInfo
    time: number
    content: string
  }[]
}
