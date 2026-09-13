const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
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
    CATEGORY_ID: "1548475260276310016" 
};

// Хранилище для временных данных сессий заполнения
const sessions = new Map();

client.once('ready', async () => {
    console.log(`🤖 Бот успешно запущен под именем: ${client.user.tag}`);

    // Автоматическая отправка кнопки при старте бота
    try {
        const channel = await client.channels.fetch(CONFIG.BUTTON_CHANNEL_ID);
        if (channel) {
            // Очищаем старые сообщения бота в этом канале, чтобы кнопки не дублировались
            const messages = await channel.messages.fetch({ limit: 10 });
            const botMessages = messages.filter(m => m.author.id === client.user.id);
            if (botMessages.size > 0) {
                await channel.bulkDelete(botMessages).catch(() => {});
            }

            const embed = new EmbedBuilder()
                .setTitle('✨ Подача заявки / Заполнение анкеты ✨')
                .setDescription('Нажмите на кнопку ниже, чтобы начать заполнение формы прямо на сервере. Бот создаст для вас приватный канал.')
                .setColor('#2ecc71');

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('btn_open_modal_start')
                    .setLabel('Заполнить анкету')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('📝')
            );

            await channel.send({ embeds: [embed], components: [row] });
            console.log('✅ Стартовая кнопка успешно обновлена в канале!');
        }
    } catch (err) {
        console.error('Ошибка автоматической отправки кнопки:', err);
    }
});
// Обработка интеракций (Кнопки, Модальные окна, Меню)
client.on('interactionCreate', async (interaction) => {
    try {
        // 1. Клик по главной кнопке -> Открываем окно для текстовых полей
        if (interaction.isButton() && interaction.customId === 'btn_open_modal_start') {
            const modal = new ModalBuilder()
                .setCustomId('mdl_text_inputs')
                .setTitle('Анкета: Текстовые поля');

            const t1 = new TextInputBuilder().setCustomId('inp_text1').setLabel('Текстовое поле №1').setStyle(TextInputStyle.Short).setRequired(true);
            const t2 = new TextInputBuilder().setCustomId('inp_text2').setLabel('Текстовое поле №2').setStyle(TextInputStyle.Short).setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(t1),
                new ActionRowBuilder().addComponents(t2)
            );
            return await interaction.showModal(modal);
        }

        // 2. Пользователь отправил текстовое окно -> Создаем приватный канал для меню и картинки
        if (interaction.isModalSubmit() && interaction.customId === 'mdl_text_inputs') {
            await interaction.deferReply({ ephemeral: true });

            const text1 = interaction.fields.getTextInputValue('inp_text1');
            const text2 = interaction.fields.getTextInputValue('inp_text2');
            const guild = interaction.guild;
            const user = interaction.user;

            // Создаем приватный канал
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

            // Сохраняем текстовые данные во временную сессию
            sessions.set(user.id, { text1, text2, channelId: ticketChannel.id });

            await interaction.editReply({ content: `Приватный канал для завершения анкеты создан: ${ticketChannel}` });

            // Отправляем в приватный канал выпадающее меню вариантов
            const menuEmbed = new EmbedBuilder()
                .setTitle('Шаг 3 из 4: Выбор варианта')
                .setDescription('Пожалуйста, выберите один из трех вариантов в меню ниже:')
                .setColor('#3498db');

            const menu = new StringSelectMenuBuilder()
                .setCustomId('select_anketa_variant')
                .setPlaceholder('Нажмите, чтобы выбрать вариант...')
                .addOptions([
                    { label: 'Вариант А', value: 'Вариант А' },
                    { label: 'Вариант Б', value: 'Вариант Б' },
                    { label: 'Вариант В', value: 'Вариант В' }
                ]);

            const row = new ActionRowBuilder().addComponents(menu);
            await ticketChannel.send({ content: `${user}`, embeds: [menuEmbed], components: [row] });
        }

        // 3. Пользователь выбрал вариант в меню -> Запрашиваем загрузку картинки
        if (interaction.isStringSelectMenu() && interaction.customId === 'select_anketa_variant') {
            await interaction.deferUpdate();
            const user = interaction.user;
            const session = sessions.get(user.id);
            if (!session) return;

            session.variant = interaction.values[0]; // ИСПРАВЛЕНО: Извлекаем строку из массива вариантов

            const ticketChannel = interaction.channel;
            
            // Удаляем выпадающее меню
            await interaction.editReply({ components: [] });

            await ticketChannel.send(`**Шаг 4 из 4.** Отлично! Теперь **прикрепите и отправьте картинку/скриншот** напрямую файлом в этот чат:`);

            // Ждем загрузки файла от пользователя
            const filter = m => m.author.id === user.id;
            const collected = await ticketChannel.awaitMessages({ filter, max: 1, time: 300000 });
            
            if (!collected.size) {
                await ticketChannel.send(`⏱ Время ожидания истекло. Канал удаляется.`);
                return setTimeout(() => ticketChannel.delete().catch(() => {}), 5000);
            }

            const imgMessage = collected.first();
            const attachment = imgMessage.attachments.first();
            const finalImageUrl = attachment ? attachment.url : null;

            await ticketChannel.send(`🎉 Спасибо! Анкета успешно отправлена администрации. Этот канал закроется через 5 секунд.`);

            // АВТОМАТИЧЕСКИЙ РАСЧЕТ ДАТ
            const now = new Date();
            const nextMonth = new Date();
            nextMonth.setMonth(now.getMonth() + 1);

            const tsToday = Math.floor(now.getTime() / 1000);
            const tsNextMonth = Math.floor(nextMonth.getTime() / 1000);

            // Отправляем финальный отчет админам с кнопками Одобрить/Отказать
            const adminChannel = interaction.guild.channels.cache.get(CONFIG.ADMIN_CHANNEL_ID);
            if (adminChannel) {
                const adminEmbed = new EmbedBuilder()
                    .setTitle(`📥 Новая заполненная анкета от ${user.username}`)
                    .setColor('#3498db')
                    .addFields(
                        { name: 'Текст 1', value: String(session.text1), inline: false },
                        { name: 'Текст 2', value: String(session.text2), inline: false },
                        { name: 'Выбранный вариант', value: String(session.variant), inline: false },
                        { name: 'Дата подачи', value: `<t:${tsToday}:D>`, inline: true },
                        { name: 'Дата окончания (через месяц)', value: `<t:${tsNextMonth}:D>`, inline: true }
                    )
                    .setFooter({ text: `ID автора: ${user.id}` })
                    .setTimestamp();

                if (finalImageUrl) adminEmbed.setImage(finalImageUrl);

                const adminButtons = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('admin_approve').setLabel('Одобрить').setStyle(ButtonStyle.Success).setEmoji('✅'),
                    new ButtonBuilder().setCustomId('admin_deny').setLabel('Отказать').setStyle(ButtonStyle.Danger).setEmoji('❌')
                );

                await adminChannel.send({ embeds: [adminEmbed], components: [adminButtons] });
            }

            // Очищаем сессию и удаляем приватный канал
            sessions.delete(user.id);
            setTimeout(() => ticketChannel.delete().catch(() => {}), 5000);
        }

        // 4. Логика работы кнопок «Одобрить» и «Отказать» в канале администрации
        if (interaction.isButton() && (interaction.customId === 'admin_approve' || interaction.customId === 'admin_deny')) {
            await interaction.deferUpdate();

            const oldEmbeds = interaction.message.embeds;
            if (!oldEmbeds || oldEmbeds.length === 0) return;

            const updatedEmbed = EmbedBuilder.from(oldEmbeds[0]);

            if (interaction.customId === 'admin_approve') {
                updatedEmbed.setTitle('✅ Отчет принят').setColor('#2ecc71');
            } else if (interaction.customId === 'admin_deny') {
                updatedEmbed.setTitle('❌ Отчет отклонен').setColor('#e74c3c');
            }

            await interaction.message.edit({ embeds: [updatedEmbed], components: [] });
        }
    } catch (globalError) {
        console.error('❌ КРИТИЧЕСКАЯ ОШИБКА ДЕЙСТВИЯ БОТА:', globalError);
    }
});

client.login(process.env.TOKEN);
