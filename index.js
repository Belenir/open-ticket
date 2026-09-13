const {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    EmbedBuilder,
    ChannelType,
    PermissionFlagsBits,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const http = require('http');
const https = require('https');

// ============================================================
// 1. ВЕБ-ЗАГЛУШКА + KEEP-ALIVE (чтобы Render не "усыплял" бота)
// ============================================================
const PORT = process.env.PORT || 10000;

http.createServer((req, res) => res.end('Бот активен!')).listen(PORT, () => {
    console.log(`🌐 Веб-сервер запущен на порту ${PORT}`);
});

setInterval(() => {
    const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, (res) => {
        console.log(`💓 Keep-alive ping: ${res.statusCode}`);
    }).on('error', (err) => {
        console.error('💔 Keep-alive ping error:', err.message);
    });
}, 14 * 60 * 1000);

// ============================================================
// 2. НАСТРОЙКИ
// ============================================================
const CONFIG = {
    BUTTON_CHANNEL_ID: "1548418283148017837",
    ADMIN_CHANNEL_ID: "1548418283148017837",
    CATEGORY_ID: "1548475260276310016",
    CREATOR_ROLE_ID: "1548417844864098445",
    BUTTON_MESSAGE_ID: "1548497891243331635",

    // 👇 Картинка, которая автоматически подставляется
    //    при выборе варианта "500 000$" (пропуск 4 шага)
    DEFAULT_SCREENSHOT_URL: "https://i.imgur.com/26UtsTJ.png",

    // 👇 Значение опции, при котором пропускается 4 шаг
    SKIP_STEP4_PRICE: "500 000$"
};

const sessions = new Map();

// ============================================================
// 3. КЛИЕНТ
// ============================================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ============================================================
// 4. ФУНКЦИЯ ФИНАЛИЗАЦИИ ОТЧЕТА (общая для обоих сценариев)
// ============================================================
async function finalizeReport({ user, session, ticketChannel, imageUrl, guild }) {
    // Сообщение пользователю в приватном канале
    await ticketChannel.send(
        `🎉 Спасибо! Отчет успешно сформирован.\n\n🔗 Нажмите сюда, чтобы вернуться обратно: <#${CONFIG.BUTTON_CHANNEL_ID}>\n*(Этот чат автоматически удалится через 5 секунд)*`
    ).catch(() => {});

    // Расчет дат
    const now = new Date();
    const nextMonth = new Date();
    nextMonth.setMonth(now.getMonth() + 1);

    const tsToday = Math.floor(now.getTime() / 1000);
    const tsNextMonth = Math.floor(nextMonth.getTime() / 1000);

    // Отправка в админ-канал
    const adminChannel = guild.channels.cache.get(CONFIG.ADMIN_CHANNEL_ID);
    if (adminChannel) {
        const adminEmbed = new EmbedBuilder()
            .setAuthor({
                name: `Отправитель: ${user.username}`,
                iconURL: user.displayAvatarURL({ dynamic: true })
            })
            .setTitle('📥 Новый отчет о выдаче лицензии')
            .setDescription(`Автор отчета: ${user}`)
            .setColor('#3498db')
            .addFields(
                { name: 'Имя Фамилия | Статик получившего', value: String(session.nameStatic || '—'), inline: false },
                { name: 'Дискорд получившего', value: String(session.discordUser || '—'), inline: false },
                { name: 'Стоимость выдачи', value: String(session.price || '—'), inline: false },
                { name: 'Дата выдачи', value: `<t:${tsToday}:D>`, inline: true },
                { name: 'Дата окончания лицензии', value: `<t:${tsNextMonth}:D>`, inline: true }
            )
            .setFooter({ text: `ID отправителя: ${user.id}` })
            .setTimestamp()
            .setImage(imageUrl);

        const adminButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('admin_approve')
                .setLabel('Одобрить')
                .setStyle(ButtonStyle.Success)
                .setEmoji('✅'),
            new ButtonBuilder()
                .setCustomId('admin_deny')
                .setLabel('Отказать')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('❌')
        );

        await adminChannel.send({
            content: `<@&${CONFIG.CREATOR_ROLE_ID}>`,
            embeds: [adminEmbed],
            components: [adminButtons]
        }).catch(() => {});
    }

    // Удаляем сессию и канал
    sessions.delete(user.id);
    setTimeout(() => ticketChannel.delete().catch(() => {}), 5000);
}

// ============================================================
// 5. ГОТОВНОСТЬ БОТА — публикация кнопки
// ============================================================
client.once('clientReady', async () => {
    console.log(`🤖 Бот успешно запущен под именем: ${client.user.tag}`);

    try {
        const channel = await client.channels.fetch(CONFIG.BUTTON_CHANNEL_ID).catch(() => null);
        if (!channel) {
            console.error('❌ Канал для кнопки не найден. Проверьте BUTTON_CHANNEL_ID.');
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle('💵 **Отчет о выдаче лицензии** 💵')
            .setDescription('Нажмите на кнопку ниже, чтобы начать заполнение отчета прямо на сервере. Бот создаст для вас приватный канал.')
            .setColor('#2ecc71');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('btn_start_wizard')
                .setLabel('Заполнить отчет')
                .setStyle(ButtonStyle.Success)
                .setEmoji('📝')
        );

        let targetMessage = null;
        if (CONFIG.BUTTON_MESSAGE_ID && CONFIG.BUTTON_MESSAGE_ID.trim() !== "") {
            targetMessage = await channel.messages.fetch(CONFIG.BUTTON_MESSAGE_ID).catch(() => null);
        }

        if (targetMessage) {
            await targetMessage.edit({ embeds: [embed], components: [row] });
            console.log('✅ Существующая кнопка успешно ОТРЕДАКТИРОВАНА по точному ID!');
        } else {
            const sentMessage = await channel.send({ embeds: [embed], components: [row] });
            console.log(`⚠️ ВНИМАНИЕ! Новая кнопка создана. ID: ${sentMessage.id}`);
        }
    } catch (err) {
        console.error('❌ Ошибка автоматического обновления кнопки:', err);
    }
});

// ============================================================
// 6. ОБРАБОТКА ВЗАИМОДЕЙСТВИЙ
// ============================================================
client.on('interactionCreate', async (interaction) => {
    try {
        // ----------------------------------------------------
        // 6.1. Кнопка "Заполнить отчет"
        // ----------------------------------------------------
        if (interaction.isButton() && interaction.customId === 'btn_start_wizard') {
            await interaction.deferReply({ flags: [64] });

            const guild = interaction.guild;
            const user = interaction.user;

            let ticketChannel;
            try {
                ticketChannel = await guild.channels.create({
                    name: `отчет-${user.username}`,
                    type: ChannelType.GuildText,
                    parent: CONFIG.CATEGORY_ID,
                    permissionOverwrites: [
                        {
                            id: guild.roles.everyone.id,
                            deny: [PermissionFlagsBits.ViewChannel]
                        },
                        {
                            id: user.id,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.AttachFiles,
                                PermissionFlagsBits.ReadMessageHistory
                            ]
                        },
                        {
                            id: client.user.id,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.AttachFiles
                            ]
                        }
                    ]
                });
            } catch (err) {
                console.error('❌ Не удалось создать канал:', err);
                return interaction.editReply({
                    content: '⚠️ Не удалось создать приватный канал. Проверьте права бота (Manage Channels) и ID категории.'
                }).catch(() => {});
            }

            sessions.set(user.id, {
                step: 1,
                userPing: `<@${user.id}>`,
                channelId: ticketChannel.id,
                createdAt: Date.now()
            });

            await interaction.editReply({
                content: `Приватный канал для заполнения отчета создан! 📂 Перейдите сюда: ${ticketChannel}`
            }).catch(() => {});

            setTimeout(() => {
                interaction.deleteReply().catch(() => {});
            }, 7000);

            await ticketChannel.send(
                `${user}\n**Вопрос 1 из 4.** Введите: *Имя Фамилия | Статик получившего лицензию*`
            ).catch(() => {});
        }

        // ----------------------------------------------------
        // 6.2. Выпадающее меню выбора стоимости (Шаг 3)
        //     👇 ЗДЕСЬ ПРОИСХОДИТ ПРОПУСК 4 ШАГА
        // ----------------------------------------------------
        if (interaction.isStringSelectMenu() && interaction.customId === 'select_license_price') {
            await interaction.deferUpdate();

            const user = interaction.user;
            const session = sessions.get(user.id);
            if (!session || session.step !== 3) return;

            session.price = interaction.values[0];
            session.step = 4;

            const ticketChannel = interaction.channel;
            await interaction.editReply({ components: [] }).catch(() => {});

            // 👇 ПРОВЕРКА: если выбрана цена 500 000$ — пропускаем 4 шаг
            if (session.price === CONFIG.SKIP_STEP4_PRICE) {
                await ticketChannel.send(
                    `✅ Вы выбрали вариант **${CONFIG.SKIP_STEP4_PRICE}** — шаг со скриншотом пропускается, картинка будет подставлена автоматически.`
                ).catch(() => {});

                await finalizeReport({
                    user,
                    session,
                    ticketChannel,
                    imageUrl: CONFIG.DEFAULT_SCREENSHOT_URL,
                    guild: interaction.guild
                });
                return;
            }

            // Иначе — обычный 4 шаг со скриншотом
            await ticketChannel.send(
                `**Вопрос 4 из 4.** Отлично! Теперь прикрепите и отправьте **Скриншот переписки с человеком о лицензии** напрямую файлом в этот чат:`
            ).catch(() => {});
        }

        // ----------------------------------------------------
        // 6.3. Кнопки "Одобрить" / "Отказать"
        // ----------------------------------------------------
        if (
            interaction.isButton() &&
            (interaction.customId === 'admin_approve' || interaction.customId === 'admin_deny')
        ) {
            const member = interaction.member;

            if (!CONFIG.CREATOR_ROLE_ID || !member.roles.cache.has(CONFIG.CREATOR_ROLE_ID)) {
                return interaction.reply({
                    content: '🛑 **У вас нет роли Creator для управления этим отчетом!**',
                    flags: [64]
                }).catch(() => {});
            }

            const oldEmbeds = interaction.message.embeds;
            if (!oldEmbeds || oldEmbeds.length === 0) return;
            const oldEmbed = oldEmbeds[0];

            if (interaction.customId === 'admin_approve') {
                await interaction.deferUpdate();

                const updatedEmbed = EmbedBuilder.from(oldEmbed)
                    .setTitle('✅ Отчет принят')
                    .setColor('#2ecc71');

                await interaction.message.edit({ embeds: [updatedEmbed], components: [] }).catch(() => {});
            } else if (interaction.customId === 'admin_deny') {
                const denyModal = new ModalBuilder()
                    .setCustomId('mdl_deny_reason_submit')
                    .setTitle('Причина отказа');

                const reasonInput = new TextInputBuilder()
                    .setCustomId('inp_deny_reason')
                    .setLabel('Причина отказа:')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Введите подробную причину отклонения отчета...')
                    .setRequired(true);

                denyModal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
                await interaction.showModal(denyModal);
            }
        }

        // ----------------------------------------------------
        // 6.4. Модальное окно с причиной отказа
        // ----------------------------------------------------
        if (interaction.isModalSubmit() && interaction.customId === 'mdl_deny_reason_submit') {
            await interaction.deferUpdate();

            const denyReason = interaction.fields.getTextInputValue('inp_deny_reason');

            const oldEmbeds = interaction.message.embeds;
            if (!oldEmbeds || oldEmbeds.length === 0) return;
            const oldEmbed = oldEmbeds[0];

            const updatedEmbed = EmbedBuilder.from(oldEmbed)
                .setTitle('❌ Отчет отклонен')
                .setColor('#e74c3c')
                .addFields({ name: '🚫 Причина отказа', value: String(denyReason), inline: false });

            await interaction.message.edit({ embeds: [updatedEmbed], components: [] }).catch(() => {});
        }
    } catch (interError) {
        console.error('❌ Ошибка во время обработки интеракций:', interError);

        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '⚠️ Произошла ошибка при обработке запроса.',
                    flags: [64]
                });
            }
        } catch (_) {}
    }
});

// ============================================================
// 7. ОБРАБОТКА СООБЩЕНИЙ (шаги 1, 2 и 4)
// ============================================================
client.on('messageCreate', async (message) => {
    try {
        if (message.author.bot) return;
        if (!message.guild) return;

        const user = message.author;
        const session = sessions.get(user.id);

        if (!session || message.channel.id !== session.channelId) return;

        const ticketChannel = message.channel;

        // --- Шаг 1: Имя Фамилия | Статик ---
        if (session.step === 1) {
            session.nameStatic = message.content;
            session.step = 2;
            return await ticketChannel.send(
                `**Вопрос 2 из 4.** Введите: *Дискорд получившего лицензию*`
            ).catch(() => {});
        }

        // --- Шаг 2: Дискорд ---
        if (session.step === 2) {
            session.discordUser = message.content;
            session.step = 3;

            const menuEmbed = new EmbedBuilder()
                .setTitle('Вопрос 3 из 4: Стоимость выдачи')
                .setDescription('Пожалуйста, выберите стоимость выдачи лицензии из вариантов ниже:')
                .setColor('#3498db');

            const menu = new StringSelectMenuBuilder()
                .setCustomId('select_license_price')
                .setPlaceholder('Нажмите для выбора цены...')
                .addOptions([
                    { label: '100 000$', value: '100 000$' },
                    { label: '300 000$', value: '300 000$' },
                    { label: '500 000$', value: '500 000$' }
                ]);

            const row = new ActionRowBuilder().addComponents(menu);
            return await ticketChannel.send({ embeds: [menuEmbed], components: [row] }).catch(() => {});
        }

        // --- Шаг 4: Скриншот (только для 100 000$ и 300 000$) ---
        if (session.step === 4) {
            const attachment = message.attachments.first();

            if (!attachment || !attachment.contentType || !attachment.contentType.startsWith('image/')) {
                return await ticketChannel.send(
                    '⚠️ **Ошибка: Вы не прикрепили изображение!**\nПожалуйста, прикрепите и отправьте именно **картинку/скриншот** напрямую файлом:'
                ).catch(() => {});
            }

            await finalizeReport({
                user,
                session,
                ticketChannel,
                imageUrl: attachment.proxyURL,
                guild: message.guild
            });
        }
    } catch (error) {
        console.error('❌ Ошибка при обработке сообщения:', error);
    }
});

// ============================================================
// 8. СЛУЖЕБНЫЕ ОБРАБОТЧИКИ
// ============================================================
client.on('error', (err) => console.error('❌ Discord Client Error:', err));
process.on('unhandledRejection', (err) => console.error('❌ Unhandled Rejection:', err));

// Автоочистка "зависших" сессий (старше 1 часа)
setInterval(() => {
    const now = Date.now();
    for (const [userId, session] of sessions.entries()) {
        if (session.createdAt && now - session.createdAt > 60 * 60 * 1000) {
            sessions.delete(userId);
            console.log(`🧹 Удалена зависшая сессия пользователя ${userId}`);
        }
    }
}, 10 * 60 * 1000);

// ============================================================
// 9. ЗАПУСК
// ============================================================
client.login(process.env.TOKEN);
