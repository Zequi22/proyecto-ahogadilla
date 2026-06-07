const {
    Client,
    GatewayIntentBits,
} = require('discord.js');

const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus
} = require('@discordjs/voice');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const TOKEN = 'TU_TOKEN';

// ID del canal que quieres vigilar
const CANAL_OBJETIVO = '123456789012345678';

client.on('voiceStateUpdate', (oldState, newState) => {

    // Usuario entra al canal objetivo
    if (
        oldState.channelId !== CANAL_OBJETIVO &&
        newState.channelId === CANAL_OBJETIVO
    ) {

        const connection = joinVoiceChannel({
            channelId: CANAL_OBJETIVO,
            guildId: newState.guild.id,
            adapterCreator: newState.guild.voiceAdapterCreator
        });

        const player = createAudioPlayer();

        // Archivo de sonido
        const resource = createAudioResource('./sonido.mp3');

        connection.subscribe(player);
        player.play(resource);

        player.once(AudioPlayerStatus.Idle, () => {
            connection.destroy();
        });
    }
});

client.login(TOKEN);