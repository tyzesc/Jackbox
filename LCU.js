const events = require('events')
const fetch = require('node-fetch')
const fs = require('fs')

const https = require("https");
const agent = new https.Agent({ rejectUnauthorized: false })

const lockfilePath = 'C:\\LOL\\32775\\LeagueClient\\lockfile'

const GAMEFLOW = {
    None: "None",
    Lobby: "Lobby",
    Matchmaking: "Matchmaking",
    ReadyCheck: "ReadyCheck",
    ChampSelect: "ChampSelect",
    InProgress: "InProgress",
    Reconnect: "Reconnect",
    PreEndOfGame: "PreEndOfGame",
    EndOfGame: "EndOfGame",
}

const ConversationType = {
    championSelect: "championSelect",
    chat: "chat",
    club: "club",
    customGame: "customGame",
    postGame: "postGame"
}

const CHATTYPE = {
    celebration: "celebration",
    chat: "chat",
    groupchat: "groupchat",
    system: "system"
}

const tierTW = {
    IRON: "鐵",
    BRONZE: "銅",
    SILVER: "銀",
    GOLD: "金",
    PLATINUM: "鉑",
    DIAMOND: "鑽",
    MASTER: "大師",
    GRANDMASTER: "宗師",
    CHALLENGER: "菁英"
}

const divisionTW = {
    I: "1",
    II: "2",
    III: "3",
    IV: "4"
}

class Message {
    constructor(chattype, chatname, text, msgtype) {
        this.chattype = chattype
        this.chatname = chatname
        this.text = text
        this.msgtype = msgtype
    }
}

class LCU extends events.EventEmitter {
    constructor() {
        super()

        this.penddingMsg = []

        let interval = setInterval(() => {
            if (fs.existsSync(lockfilePath)) {
                fs.readFile(lockfilePath, (err, data) => {
                    let content = data.toString('utf-8')

                    let arr = content.split(':')
                    this.process = arr[0]
                    this.pid = arr[1]
                    this.port = arr[2]
                    this.key = arr[3]
                    this.protocol = arr[4]

                    this.emit('connected')
                    this.startListener()

                    clearInterval(interval)
                })
            }
        }, 1000)

        // chat loop
        setInterval(() => {
            if (this.penddingMsg.length === 0 || this.key === undefined)
                return

            let m = this.penddingMsg.shift()
            this.getConversation(m.chattype, m.chatname)
                .then(msg => {
                    if (msg === undefined)
                        return this.penddingMsg.unshift(m)
                    this.postConversation(msg, m.text, m.msgtype)
                })
        }, 200)
    }

    async call(method, url, body, isjson = true) {
        if (url.startsWith('/'))
            url = url.replace('/', '')
        let uri = `${this.protocol}://127.0.0.1:${this.port}/${url}`
        let params = ""
        if (isjson || Array.isArray(body)) {
            params = JSON.stringify(body)
        } else {
            params = URLSearchParams()
            for (let key in body)
                params.append(key, body[key])
        }

        let authorization = "Basic " + Buffer.from("riot:" + this.key).toString('base64')
        let options = { method: method, agent, headers: { 'Accept': 'application/json', 'Authorization': authorization } }
        if (method.toLowerCase() !== "get") options.body = params
        if (isjson) options.headers['Content-Type'] = 'application/json'

        return await fetch(uri, options).then(res => res.json())
    }

    async startListener() {
        let oldStatus = "NONE"
        setInterval(async () => {
            let newStatus = await this.call('get', 'lol-gameflow/v1/gameflow-phase')
            if (oldStatus !== newStatus)
                this.emit(newStatus)
            oldStatus = newStatus
        }, 1000)
    }

    async startSelectListener() {
        let cnt = 0
        let selectedChampion = Array(10).fill(-1)
        let actions = []
        let interval = setInterval(() => {
            this.call('get', '/lol-champ-select/v1/session').then(json => {
                let act = json.actions
                if (act === undefined || !Array.isArray(act) || actions.length === act.length)
                    return

                let maxPlayer = json.myTeam.length + json.theirTeam.length

                let done = true
                for (let i = actions.length; i < act.length; i++) {
                    for (let x = act[i].length - 1; x >= 0; x--) {
                        let item = act[i][x]
                        if (item.type === 'pick') {
                            let slotId = item.actorCellId
                            if (slotId >= json.myTeam.length)
                                slotId += (5 - json.myTeam.length)
                            if (item.completed == true && selectedChampion[slotId] === -1) {
                                this.emit('playerSelectChampion', slotId, item.championId, json.myTeam, json.theirTeam)
                                selectedChampion[slotId] = item.championId
                                cnt++
                            }
                            else
                                done = false
                        }
                    }
                }

                if (done) actions = JSON.parse(JSON.stringify(act))
                if (cnt === maxPlayer) clearInterval(interval)
            })
        }, 3000)
    }

    addPenddingMessage(msg) {
        this.penddingMsg.push(msg)
    }

    async postConversation(message, text, type = "celebration") {
        let id = message.id
        this.call('post', `/lol-chat/v1/conversations/${id}/messages`, { "body": text, "fromId": "0", "fromPid": "", "fromSummonerId": 0, "id": "", "isHistorical": false, "timestamp": "2020-03-18T00:00:00.000Z", "type": type })
    }

    async arrayAllConversation() {
        let result = []
        await this.call('get', '/lol-chat/v1/conversations').then(arr => {
            result = arr.reduce((accumulator, elem) => {
                accumulator.push({ type: elem.type, name: elem.name, id: elem.id })
                return accumulator
            }, [])
        }).catch(e => {
            console.error(`arrayAllConversation error ${e}`)
        })
        return result;
    }

    async getConversation(type, name) {
        let conversations = await this.arrayAllConversation()
        return conversations.find(elem => elem.name === name && elem.type === type)
    }

    async getSummoner(query) {
        let user = {}
        let res

        if (Number.isInteger(query)) {
            res = await this.call('get', `lol-summoner/v1/summoners/${query}`, {})
        } else {
            // res = (await this.call('post', 'lol-summoner/v2/summoners/names', [query]))[0]
            res = await this.call('get', `/lol-summoner/v1/summoners?name=${encodeURI(query)}`)
        }

        user.puuid = res.puuid
        user.accountId = res.accountId
        user.displayName = res.displayName
        user.summonerId = res.summonerId

        await this.call('get', `lol-ranked/v1/league-ladders/${user.puuid}`, {}).then(arr => {
            user.rank = {}
            for (let item of arr) {
                let msg = tierTW[item.requestedRankedEntry.tier] +
                    divisionTW[item.requestedRankedEntry.division] + " " +
                    item.requestedRankedEntry.leaguePoints + " " +
                    item.requestedRankedEntry.wins + "勝 " +
                    item.requestedRankedEntry.miniseriesResults.join("")

                if (item.queueType === "RANKED_FLEX_SR")
                    user.rank.flex = msg
                if (item.queueType === "RANKED_SOLO_5x5")
                    user.rank.solo = msg
            }
        })

        return user
    }

    async getChampionStats(player, championId) {
        let result = {}
        await this.call('get', `/lol-career-stats/v1/summoner-games/${player.puuid}/season/10`).then(arr => {
            let a = arr.filter(elem => elem.queueType !== "blind5" && elem.championId == championId)
            let v = a.filter(elem => elem.stats['CareerStats.js'].victory === 1)

            result.total = a.length
            result.winrate = (a.length == 0) ? 0 : parseInt(v.length / a.length * 100)
        })

        await this.call('get', `/lol-collections/v1/inventories/${player.summonerId}/champion-mastery`).then(arr => {
            let a = arr.filter(elem => elem.championId == championId).pop()
            if (a !== undefined) {
                result.points = a.championPoints
                result.lastPlayTime = a.lastPlayTime
            }
        })

        return result
    }
}

module.exports.LCU = LCU
module.exports.Message = Message
module.exports.CHATTYPE = CHATTYPE
module.exports.GAMEFLOW = GAMEFLOW
module.exports.ConversationType = ConversationType