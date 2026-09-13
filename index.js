const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const http = require('http');

// Создаем веб-заглушку для хостинга Render
http.createServer((req, res) => res.end('Бот активен!')).listen(process.env.PORT || 10000);

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// НАСТРОЙКА ID КАНАЛОВ, КАТЕГОРИИ, РОЛИ И КНОПКИ
const CONFIG = {
    BUTTON_CHANNEL_ID: "1548418283148017837", 
    ADMIN_CHANNEL_ID: "1548418283148017837", 
    CATEGORY_ID: "1548475260276310016",
    CREATOR_ROLE_ID: "1548417844864098445",
    BUTTON_MESSAGE_ID: "1548497891243331635" 
};

// Хранилище для временных данных сессий заполнения
const sessions = new Map();

client.once('ready', async () => {
    console.log(`🤖 Бот успешно запущен под именем: ${client.user.tag}`);

    try {
        const channel = await client.channels.fetch(CONFIG.BUTTON_CHANNEL_ID);
        if (channel) {
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
                console.log(`⚠️ ВНИМАНИЕ! Новая кнопка создана. СКОПИРУЙТЕ ЕЁ ID ИЗ КОНСОЛИ И ВСТАВЬТЕ В КОД: ${sentMessage.id}`);
            }
        }
    } catch (err) {
        console.error('Ошибка автоматического обновления кнопки:', err);
    }
});
// Обработка интеракций (Кнопки, Меню выпадающих списков, Модальные окна)
client.on('interactionCreate', async (interaction) => {
    try {
        // 1. Нажатие на кнопку "Заполнить отчет" -> Создаем канал и даем ссылку
        if (interaction.isButton() && interaction.customId === 'btn_start_wizard') {
            await interaction.deferReply({ ephemeral: true });

            const guild = interaction.guild;
            const user = interaction.user;

            const ticketChannel = await guild.channels.create({
                name: `отчет-${user.username}`,
                type: ChannelType.GuildText,
                parent: CONFIG.CATEGORY_ID,
                permissionOverwrites: [
                    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] },
                    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] }
                ]
            });

            sessions.set(user.id, { step: 1, userPing: `<@${user.id}>`, channelId: ticketChannel.id });

            await interaction.editReply({ content: `Приватный канал для заполнения отчета создан! 📂 Перейдите сюда: ${ticketChannel}` });

            setTimeout(() => {
                interaction.deleteReply().catch(() => {});
            }, 7000);

            await ticketChannel.send(`${user}\n**Вопрос 1 из 4.** Введите: *Имя Фамилия | Статик получившего лицензию*`);
        }

        // 2. Логика интерактивного выпадающего меню стоимости (Шаг 3)
        if (interaction.isStringSelectMenu() && interaction.customId === 'select_license_price') {
            await interaction.deferUpdate();
            const user = interaction.user;
            const session = sessions.get(user.id);
            if (!session || session.step !== 3) return;

            session.price = interaction.values; 
            session.step = 4; 

            const ticketChannel = interaction.channel;
            await interaction.editReply({ components: [] }); 

            await ticketChannel.send(`**Вопрос 4 из 4.** Отлично! Теперь прикрепите и отправьте **Скриншот переписки с человеком о лицензии** напрямую файлом в этот чат:`);
        }

        // 3. Обработка кнопок «Одобрить» и «Отказать» администрации сервера
        if (interaction.isButton() && (interaction.customId === 'admin_approve' || interaction.customId === 'admin_deny')) {
            const member = interaction.member;
            
            if (!CONFIG.CREATOR_ROLE_ID || !member.roles.cache.has(CONFIG.CREATOR_ROLE_ID)) {
                return await interaction.reply({ 
                    content: '🛑 **У вас нет роли Creator для управления этим отчетом!**', 
                    ephemeral: true 
                });
            }

            const oldEmbeds = interaction.message.embeds;
            if (!oldEmbeds || oldEmbeds.length === 0) return;
            const oldEmbed = oldEmbeds[0];
            const authorMention = oldEmbed.description || "Пользователь";

            if (interaction.customId === 'admin_approve') {
                await interaction.deferUpdate();

                const updatedEmbed = EmbedBuilder.from(oldEmbed)
                    .setTitle(`✅ Отчет принят`)
                    .setColor('#2ecc71');

                await interaction.message.edit({ embeds: [updatedEmbed], components: [] });
            } 
            else if (interaction.customId === 'admin_deny') {
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
        // 4. Логика обработки отправленного модального окна с причиной отказа
        if (interaction.isModalSubmit() && interaction.customId === 'mdl_deny_reason_submit') {
            await interaction.deferUpdate();

            const denyReason = interaction.fields.getTextInputValue('inp_deny_reason');
            
            const oldEmbeds = interaction.message.embeds;
            if (!oldEmbeds || oldEmbeds.length === 0) return;
            const oldEmbed = oldEmbeds[0];

            const updatedEmbed = EmbedBuilder.from(oldEmbed)
                .setTitle(`❌ Отчет отклонен`)
                .setColor('#e74c3c')
                .addFields({ name: '🚫 Причина отказа', value: String(denyReason), inline: false });

            await interaction.message.edit({ embeds: [updatedEmbed], components: [] });
        }

    } catch (interError) {
        console.error('❌ Ошибка во время обработки нажатий бота:', interError);
    }
});

// Слушаем обычные сообщения в приватных текстовых каналах (Шаги 1, 2 и 4)
client.on('messageCreate', async (message) => {
    try {
        if (message.author.bot) return;

        const user = message.author;
        const session = sessions.get(user.id);
        if (!session || message.channel.id !== session.channelId) return;

        const ticketChannel = message.channel;

        if (session.step === 1) {
            session.nameStatic = message.content;
            session.step = 2;
            return await ticketChannel.send(`**Вопрос 2 из 4.** Введите: *Дискорд получившего лицензию*`);
        }

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
            return await ticketChannel.send({ embeds: [menuEmbed], components: [row] });
        }

        if (session.step === 4) {
            const attachment = message.attachments.first();
            
            if (!attachment || !attachment.contentType || !attachment.contentType.startsWith('image/')) {
                return await ticketChannel.send('⚠️ **Ошибка: Вы не прикрепили изображение!**\nПожалуйста, прикрепите и отправьте именно **картинку/скриншот** напрямую файлом:');
            }

            const finalImageUrl = attachment.proxyURL;

            await ticketChannel.send(`🎉 Спасибо! Отчет успешно сформирован.\n\n🔗 Нажмите сюда, чтобы вернуться обратно: <#${CONFIG.BUTTON_CHANNEL_ID}>\n*(Этот чат автоматически удалится через 5 секунд)*`);

            const now = new Date();
            const nextMonth = new Date();
            nextMonth.setMonth(now.getMonth() + 1);

            const tsToday = Math.floor(now.getTime() / 1000);
            const tsNextMonth = Math.floor(nextMonth.getTime() / 1000);

            const adminChannel = message.guild.channels.cache.get(CONFIG.ADMIN_CHANNEL_ID);
            if (adminChannel) {
                const adminEmbed = new EmbedBuilder()
                    .setAuthor({ name: `Отправитель: ${user.username}`, iconURL: user.displayAvatarURL({ dynamic: true }) })
                    .setTitle(`📥 Новый отчет о выдаче лицензии`)
                    .setDescription(`Автор отчета: ${user}`) 
                    .setColor('#3498db')
                    .addFields(
                        { name: 'Имя Фамилия | Статик получившего', value: String(session.nameStatic), inline: false },
                        { name: 'Дискорд получившего', value: String(session.discordUser), inline: false },
                        { name: 'Стоимость выдачи', value: String(session.price), inline: false },
                        { name: 'Дата выдачи', value: `<t:${tsToday}:D>`, inline: true },
                        { name: 'Дата окончания лицензии', value: `<t:${tsNextMonth}:D>`, inline: true }
                    )
                    .setFooter({ text: `ID отправителя: ${user.id}` })
                    .setTimestamp();

                adminEmbed.setImage(finalImageUrl);

                const adminButtons = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('admin_approve').setLabel('Одобрить').setStyle(ButtonStyle.Success).setEmoji('✅'),
                    new ButtonBuilder().setCustomId('admin_deny').setLabel('Отказать').setStyle(ButtonStyle.Danger).setEmoji('❌')
                );

                const mentionContent = `<@&${CONFIG.CREATOR_ROLE_ID}>`;
                await adminChannel.send({ content: mentionContent, embeds: [adminEmbed], components: [adminButtons] });
            }

            sessions.delete(user.id);
            setTimeout(() => ticketChannel.delete().catch(() => {}), 5000);
        }

    } catch (error) {
        console.error('❌ Ошибка во время обработки текстового ответа пользователя:', error);
    }
});

client.on('error', console.error);
client.login(process.env.TOKEN);
