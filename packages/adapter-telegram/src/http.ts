import { App, Bot, Server } from 'koishi-core'
import { Logger, defineProperty, snakeCase, assertProperty } from 'koishi-utils'
import { } from 'koa-bodyparser'
import Axios, { AxiosInstance } from 'axios'

export interface ResponsePayload {
    delete?: boolean
    ban?: boolean
    banDuration?: number
    kick?: boolean
    reply?: string
    autoEscape?: boolean
    atSender?: boolean
    approve?: boolean
    remark?: string
    reason?: string
}

declare module 'koishi-core/dist/session' {
    interface Session {
        _response?: (payload: ResponsePayload) => void
    }
}

const logger = new Logger('server')

export default class TelegramHTTPServer extends Server {
    _axios: AxiosInstance

    constructor(app: App) {
        assertProperty(app.options, 'port')
        const bot = app.options.bots.find(bot => bot.server)
        if (!bot.type) logger.info('infer type as telegram');
        super(app)
    }

    private async __listen(bot: Bot) {
        bot.ready = true
        this._axios = Axios.create({ baseURL: bot.server });
        bot._request = async (action, params) => {
            const { data } = await this._axios.get(action, params)
            return data
        }
        await bot._request('setWebhook', { url: bot.url })
        logger.info('connected to %c', bot.server)
    }

    async _listen() {
        const path = new URL(this.app.options.url).href;
        this.router.post(path, (ctx) => {
            logger.debug('receive %o', ctx.request.body)
            const meta = this.prepare(ctx.request.body)
            if (!meta) return ctx.status = 403
            const { quickOperation } = this.app.options
            if (quickOperation > 0) {
                // bypass koa's built-in response handling for quick operations
                ctx.respond = false
                ctx.res.writeHead(200, {
                    'Content-Type': 'application/json',
                })
                // use defineProperty to avoid meta duplication
                defineProperty(meta, '$response', (data: any) => {
                    meta._response = null
                    clearTimeout(timer)
                    ctx.res.write(JSON.stringify(snakeCase(data)))
                    ctx.res.end()
                })
                const timer = setTimeout(() => {
                    meta._response = null
                    ctx.res.end()
                }, quickOperation)
            }

            // dispatch events
            this.dispatch(meta)
        })

        await Promise.all(this.bots.map(bot => this.__listen(bot)))
    }

    _close() {
        logger.debug('http server closing')
        this.server.close()
    }
}

Server.types.telegram = TelegramHTTPServer