const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const http = require('http');

// Создаем веб-заглушку для хостинга Render
http.createServer((req, res) => res.end('Бот активен!')).listen(process.env.PORT || 10000);

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// НАСТРОЙКА ID КАНАЛОВ И КАТЕГОРИИ
const CONFIG = {
    BUTTON_CHANNEL_ID: "1548418283148017837", 
    ADMIN_CHANNEL_ID: "1548418283148017837",
    CATEGORY_ID: "1548475260276310016" // Категория (папка), где будут открываться временные каналы
};

client.once('ready', () => {
    console.log(`🤖 Бот успешно запущен под именем: ${client.user.tag}`);
});

// Слушаем команду для отправки кнопки
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === '!форма') {
        if (message.channel.id !== CONFIG.BUTTON_CHANNEL_ID) return;

        const embed = new EmbedBuilder()
            .setTitle('✨ Подача заявки / Заполнение анкеты ✨')
            .setDescription('Нажмите на кнопку ниже, чтобы начать заполнение формы прямо на сервере. Бот создаст для вас приватный канал.')
            .setColor('#2ecc71');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('btn_start_wizard')
                .setLabel('Заполнить анкету')
                .setStyle(ButtonStyle.Success)
                .setEmoji('📝')
        );

        await message.channel.send({ embeds: [embed], components: [row] });
        await message.delete().catch(() => {});
    }
});

// Логика пошагового опроса в приватном канале
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton() || interaction.customId !== 'btn_start_wizard') return;

    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    const user = interaction.user;

    // 1. Создаем приватный канал для пользователя
    const ticketChannel = await guild.channels.create({
        name: `анкета-${user.username}`,
        type: ChannelType.GuildText,
        parent: CONFIG.CATEGORY_ID,
        permissionOverwrites: [
            { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] },
            { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] }
        ]
    });

    await interaction.editReply({ content: `Приватный канал для заполнения анкеты создан: ${ticketChannel}` });

    // Функция-помощник для ожидания сообщения от конкретного пользователя
    const askQuestion = async (text) => {
        await ticketChannel.send(text);
        const filter = m => m.author.id === user.id;
        const collected = await ticketChannel.awaitMessages({ filter, max: 1, time: 300000 }); // 5 минут на ответ
        if (!collected.size) throw new Error('timeout');
        return collected.first();
    };

    try {
        // Пошаговый опрос
        const msg1 = await askQuestion(`**Шаг 1 из 5.** Введите ответ на текстовый вопрос №1:`);
        const text1 = msg1.content;

        const msg2 = await askQuestion(`**Шаг 2 из 5.** Введите ответ на текстовый вопрос №2:`);
        const text2 = msg2.content;

        const msg3 = await askQuestion(`**Шаг 3 из 5.** Укажите дату (например, ДД.ММ.ГГГГ):`);
        const date = msg3.content;

        const msg4 = await askQuestion(`**Шаг 4 из 5.** Выберите один из трех вариантов (напишите **А**, **Б** или **В**):`);
        const variant = msg4.content;

        // ШАГ С ПРЯМОЙ ЗАГРУЗКОЙ КАРТИНКИ
        await ticketChannel.send(`**Шаг 5 из 5.** Пожалуйста, **прикрепите и отправьте картинку/скриншот** напрямую файлом в этот чат:`);
        
        const imgFilter = m => m.author.id === user.id;
        const imgCollected = await ticketChannel.awaitMessages({ imgFilter, max: 1, time: 300000 });
        if (!imgCollected.size) throw new Error('timeout');
        
        const imgMessage = imgCollected.first();
        // Берем прямую ссылку на первый прикрепленный файл
        const attachment = imgMessage.attachments.first();
        const finalImageUrl = attachment ? attachment.url : null;

        await ticketChannel.send(`🎉 Спасибо! Анкета успешно сформирована и отправлена администрации. Этот канал автоматически удалится через 5 секунд.`);

        // Отправляем красивый Embed с реальной картинкой в админ-канал
        const adminChannel = guild.channels.cache.get(CONFIG.ADMIN_CHANNEL_ID);
        if (adminChannel) {
            const adminEmbed = new EmbedBuilder()
                .setTitle(`📥 Получена новая анкета от ${user.username}`)
                .setColor('#3498db')
                .addFields(
                    { name: 'Текст 1', value: text1, inline: false },
                    { name: 'Текст 2', value: text2, inline: false },
                    { name: 'Дата', value: date, inline: true },
                    { name: 'Выбранный вариант', value: variant, inline: true }
                )
                .setFooter({ text: `ID: ${user.id}` })
                .setTimestamp();

            if (finalImageUrl) {
                adminEmbed.setImage(finalImageUrl); // Встраиваем загруженную картинку прямо в тело формы
            } else {
                adminEmbed.setDescription(`⚠️ Пользователь не прикрепил изображение.`);
            }

            await adminChannel.send({ embeds: [adminEmbed] });
        }

        // Удаляем временный канал через 5 секунд
        setTimeout(() => ticketChannel.delete().catch(() => {}), 5000);

    } catch (error) {
        if (error.message === 'timeout') {
            await ticketChannel.send(`⏱ Время ожидания ответа истекло. Канал будет удален.`);
            setTimeout(() => ticketChannel.delete().catch(() => {}), 5000);
        } else {
            console.error(error);
        }
    }
});

client.login(process.env.TOKEN);
