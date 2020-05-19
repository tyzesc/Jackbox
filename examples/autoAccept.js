const { LCU, GAMEFLOW } = require(__dirname + '/../LCU')

const lcu = new LCU()

lcu.on('connected', () => { console.log('LeagueClient Connected') })

lcu.on(GAMEFLOW.ReadyCheck, () => {
    lcu.call('post', '/lol-matchmaking/v1/ready-check/accept').catch()
})
