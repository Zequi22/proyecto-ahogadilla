require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    ChannelType,
    PermissionFlagsBits,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    EmbedBuilder,
    MessageFlags,
} = require('discord.js');

const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    getVoiceConnection,
    entersState,
    AudioPlayerStatus,
    VoiceConnectionStatus,
} = require('@discordjs/voice');

const path = require('path');
const fs = require('fs');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

const TOKEN = process.env.TOKEN;

// Ruta absoluta al sonido, para que funcione sin importar desde dónde se ejecute
const RUTA_SONIDO = path.join(__dirname, 'sonido.mp3');

// Archivo donde se guarda el canal objetivo de cada servidor: { guildId: channelId }
const RUTA_CONFIG = path.join(__dirname, 'config.json');

const CUSTOM_ID_SELECT = 'seleccionar_canal_objetivo';

// ----- Persistencia de la configuración -----

function cargarConfig() {
    try {
        return JSON.parse(fs.readFileSync(RUTA_CONFIG, 'utf8'));
    } catch {
        return {};
    }
}

function guardarCanalObjetivo(guildId, channelId) {
    const config = cargarConfig();
    config[guildId] = channelId;
    fs.writeFileSync(RUTA_CONFIG, JSON.stringify(config, null, 2));
}

function obtenerCanalObjetivo(guildId) {
    return cargarConfig()[guildId];
}

function borrarCanalObjetivo(guildId) {
    const config = cargarConfig();
    delete config[guildId];
    fs.writeFileSync(RUTA_CONFIG, JSON.stringify(config, null, 2));
}

// ----- Registro del comando slash -----

client.once('clientReady', async () => {
    console.log(`Bot conectado como ${client.user.tag}`);

    // Registramos todos los comandos de golpe. Los de configuración solo los
    // ven quienes pueden gestionar canales; /help está disponible para todos.
    await client.application.commands.set([
        {
            name: 'help',
            description: 'Muestra la lista de comandos para configurar el bot.',
        },
        {
            name: 'cambiarcanal',
            description: 'Elige el canal de voz en el que sonará el audio al entrar.',
            defaultMemberPermissions: PermissionFlagsBits.ManageChannels,
        },
        {
            name: 'canalactual',
            description: 'Muestra el canal de voz configurado actualmente.',
            defaultMemberPermissions: PermissionFlagsBits.ManageChannels,
        },
        {
            name: 'desactivar',
            description: 'Deja de reproducir el sonido (borra el canal configurado).',
            defaultMemberPermissions: PermissionFlagsBits.ManageChannels,
        },
    ]);

    console.log('Comandos registrados: /help, /cambiarcanal, /canalactual, /desactivar');
});

// ----- Manejo de interacciones (comando y menú) -----

client.on('interactionCreate', async (interaction) => {
    // /help -> panel con todos los comandos disponibles
    if (interaction.isChatInputCommand() && interaction.commandName === 'help') {
        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🔊 Comandos del bot')
            .setDescription(
                'Este bot entra a un canal de voz y reproduce un sonido cuando alguien se une a él.',
            )
            .addFields(
                {
                    name: '/cambiarcanal',
                    value: 'Abre un menú con todos los canales de voz para elegir en cuál sonará el audio.',
                },
                {
                    name: '/canalactual',
                    value: 'Muestra el canal de voz configurado en este momento.',
                },
                {
                    name: '/desactivar',
                    value: 'Detiene el bot borrando el canal configurado (deja de reproducir).',
                },
                {
                    name: '/help',
                    value: 'Muestra este mensaje de ayuda.',
                },
            )
            .setFooter({
                text: 'Los comandos de configuración requieren el permiso "Gestionar canales".',
            });

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
    }

    // /canalactual -> muestra el canal configurado
    if (interaction.isChatInputCommand() && interaction.commandName === 'canalactual') {
        const canal = obtenerCanalObjetivo(interaction.guild.id);
        await interaction.reply({
            content: canal
                ? `El canal configurado es <#${canal}>.`
                : 'Todavía no hay ningún canal configurado. Usa **/cambiarcanal**.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    // /desactivar -> borra la configuración del servidor
    if (interaction.isChatInputCommand() && interaction.commandName === 'desactivar') {
        if (!obtenerCanalObjetivo(interaction.guild.id)) {
            await interaction.reply({
                content: 'No había ningún canal configurado.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        borrarCanalObjetivo(interaction.guild.id);
        await interaction.reply({
            content: 'Sonido desactivado. El bot ya no entrará a ningún canal.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    // 1) El usuario ejecuta /cambiarcanal -> mostramos el menú de canales de voz
    if (interaction.isChatInputCommand() && interaction.commandName === 'cambiarcanal') {
        const canalesVoz = interaction.guild.channels.cache
            .filter((c) => c.type === ChannelType.GuildVoice)
            .map((c) => c)
            .sort((a, b) => a.rawPosition - b.rawPosition)
            .slice(0, 25); // un menú admite como máximo 25 opciones

        if (canalesVoz.length === 0) {
            await interaction.reply({
                content: 'Este servidor no tiene canales de voz.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const objetivoActual = obtenerCanalObjetivo(interaction.guild.id);

        const menu = new StringSelectMenuBuilder()
            .setCustomId(CUSTOM_ID_SELECT)
            .setPlaceholder('Selecciona un canal de voz')
            .addOptions(
                canalesVoz.map((canal) => ({
                    label: canal.name.slice(0, 100),
                    value: canal.id,
                    default: canal.id === objetivoActual,
                })),
            );

        await interaction.reply({
            content: 'Elige el canal de voz en el que sonará el audio:',
            components: [new ActionRowBuilder().addComponents(menu)],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    // 2) El usuario elige una opción del menú -> guardamos el canal objetivo
    if (interaction.isStringSelectMenu() && interaction.customId === CUSTOM_ID_SELECT) {
        const channelId = interaction.values[0];
        guardarCanalObjetivo(interaction.guild.id, channelId);

        await interaction.update({
            content: `Canal objetivo actualizado a <#${channelId}>.`,
            components: [],
        });
        return;
    }
});

// ----- Reproducción del sonido al entrar alguien -----

client.on('voiceStateUpdate', async (oldState, newState) => {
    // Ignorar a otros bots (y a sí mismo) para no entrar en bucle
    if (newState.member?.user.bot) return;

    const canalObjetivo = obtenerCanalObjetivo(newState.guild.id);
    if (!canalObjetivo) return; // aún no se ha configurado con /cambiarcanal

    // Solo actuar cuando un usuario ENTRA al canal objetivo desde fuera de él
    const entraAlCanal =
        oldState.channelId !== canalObjetivo &&
        newState.channelId === canalObjetivo;

    if (!entraAlCanal) return;

    // Si el bot ya está reproduciendo en ese servidor, no abrir otra conexión
    if (getVoiceConnection(newState.guild.id)) return;

    try {
        const connection = joinVoiceChannel({
            channelId: canalObjetivo,
            guildId: newState.guild.id,
            adapterCreator: newState.guild.voiceAdapterCreator,
        });

        // Esperar a estar realmente conectado antes de reproducir
        await entersState(connection, VoiceConnectionStatus.Ready, 10_000);

        const player = createAudioPlayer();
        const resource = createAudioResource(RUTA_SONIDO);

        connection.subscribe(player);
        player.play(resource);

        // Cuando termina el sonido (una sola vez), desconectar
        player.once(AudioPlayerStatus.Idle, () => {
            connection.destroy();
        });

        player.on('error', (error) => {
            console.error('Error reproduciendo el sonido:', error.message);
            connection.destroy();
        });
    } catch (error) {
        console.error('No se pudo conectar al canal de voz:', error.message);
        getVoiceConnection(newState.guild.id)?.destroy();
    }
});

client.login(TOKEN);
