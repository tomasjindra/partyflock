import { createCheerioRouter } from 'crawlee';
import { changeDateFormat } from '../utilities/changeDateFormat.js'
import { Actor } from 'apify';


const cheerioRouter = createCheerioRouter();

cheerioRouter.addDefaultHandler(async ({ enqueueLinks, request, $, log, proxyInfo }) => {

    const title = $('title').text();
    log.info(`${title}`, { url: request.loadedUrl }, proxyInfo);
    console.log(proxyInfo)
    let result = {
        event: {
            name: $("h1").text(),
            sourceInformation: {
                uuid: request.url.split("/")[4],
                sourceId: "URL",
                sourceUrl: request.url, //rozdil od loadedUrl?
                plattform: "https://partyflock.nl",
                retrievalDate: new Date().toISOString(),
                urlToEvidenceFile: "", //todo
                urlToHtmlFile: "", //todo
                sourceDataLocalization: "nl",
            },
            description: $(".block.forcewrap").text(),
            startDateTime: changeDateFormat($("time[itemprop='startDate']").attr("datetime"), $("time[itemprop='startDate']").text()),
            endDateTime: changeDateFormat($("time[itemprop='endDate']").attr("datetime"), $("time[itemprop='endDate']").text()),
            status: $("div.sold-out").text(),
            isOnline: "",
            category: "",
            tags: [], //to be improved
            admissionInformation: [],
            numberOfInterestees: 0,
            numberOfAttendees: 0,
            ticketUrls: [$("div.event-actions.noncust.block > a:contains('Koop tickets')").attr("href")]
        },
        location: {},
        organizers: [],
        artists: []
    }


    $("table.default.vtop.prices tr").each(function () {
        result.event.admissionInformation.push({
            amount: Number($(".nowrap.right.incfee", this).text().trim()),
            currency: $(":nth-child(2)", this).text().trim(),
            category: $(".rrpad", this).text().trim().slice(0, -1)
        })
    })

    $("table.fw.vtop.default tr").each(function () {
        const interested = Number($(":contains('ge??nteresseerd') td.right", this).text())
        const visitors = Number($(":contains('bezoekers') td.right", this).text())

        result.event.numberOfInterestees += interested
        result.event.numberOfAttendees += visitors
    })

    $("div.box-column a[href^='/agenda/']:not(time a)").each(function () {
        result.event.tags.push($(this).text())
    })

    //collecting Urls and enqueueing new bined requests which info should be included in 1 common dataset 
    result.organizerUrls = []
    $("div.party.box span[itemprop='organizer'] > a[itemprop='url']").each(function () {
        result.organizerUrls.push($(this).attr("href"))
    })

    result.artistUrls = []
    $("table.lineup  tr span[itemprop='performer'] a[itemprop='url']").each(function () {
        result.artistUrls.push($(this).attr("href"))
    })

    result.locationUrls = []
    $("span[itemprop='location'] > a[href^='/location/']").each(function () {
        result.locationUrls.push(`https://partyflock.nl${$(this).attr("href")}`)
    })

    if (result.locationUrls.length > 0) {
        log.info(`enqueueing URL for location`);
        await enqueueLinks({
            label: 'details',
            forefront: true,
            urls: result.locationUrls,
            userData: result,
            transformRequestFunction: (request) => {
                request.uniqueKey = new Date().toISOString();
                return request;
            }

        });
    }
    else if (result.organizerUrls.length > 0) {
        log.info(`enqueueing URL for organizer`);
        await enqueueLinks({
            label: 'details',
            forefront: true,
            urls: [result.organizerUrls[0]],
            userData: result,
            transformRequestFunction: (request) => {
                request.uniqueKey = new Date().toISOString();
                return request;
            }
        });
    }
    else if (result.artistUrls.length > 0) {
        log.info(`enqueueing URL for artist`);
        await enqueueLinks({
            label: 'details',
            forefront: true,
            urls: [result.artistUrls[0]],
            userData: result,
            transformRequestFunction: (request) => {
                request.uniqueKey = new Date().toISOString();
                return request;
            }
        });
    }
    else {

        delete result.organizerUrls
        delete result.artistUrls
        delete result.locationUrls

        await Actor.pushData({
            ...result
        });
        console.log("Dataset pushed")
    }
});


//////////////////////////////////////////////////////////////////////////////////////////////
//collecting location / organizer / artist
cheerioRouter.addHandler('details', async ({ request, $, log, enqueueLinks, proxyInfo }) => {
    const title = $('title').text();
    log.info(`${title}`, { url: request.loadedUrl }, proxyInfo);
    console.log(proxyInfo)

    let result = request.userData

    let tags = []
    $("div.box-column a[href^='/agenda/']:not(time a)").each(function () {
        tags.push($(this).text())
    })
    let street = $("span[itemprop='streetAddress']", "table.nodyn.deflist.vtop tr:contains('Adres')").text()
    let houseNumber = street.match(/\d+$/) || "" //is it useful?
    street = street.replace(` ${houseNumber}`, "") //is it useful?
    let country = $("span[itemprop='addressCountry']", "table.nodyn.deflist.vtop tr:contains('Adres')").text()
    let emailAddresses = $("a", "table.nodyn.deflist.vtop tr:contains('E-mail')").text()
    emailAddresses === "" ? emailAddresses = null : emailAddresses = emailAddresses


    let object = {
        name: $("h1").text(),
        description: "",
        sourceInformation: {
            uuid: request.url.split("/")[4],
            sourceId: "URL",
            sourceUrl: request.url,
            plattform: "https://partyflock.nl",
            retrievalDate: new Date().toISOString(), //check time
            urlToEvidenceFile: "", //todo
            urlToHtmlFile: "", //todo
            sourceDataLocalization: "nl",
        },
        websiteUrls: [$("a[title]", "table.nodyn.deflist.vtop tr:contains('Site')").attr("title")],
        phoneNumbers: [], //not found
        emailAddresses: [emailAddresses],
        category: "", //not found
        tags: tags,
        address: {
            countryCode: "nl", //should be only nl ?
            country: country,
            street: street,
            houseNumber: houseNumber,
            postalCode: $("span[itemprop='postalCode']", "table.nodyn.deflist.vtop tr:contains('Adres')").text(),
            city: $("span[itemprop='addressLocality']", "table.nodyn.deflist.vtop tr:contains('Adres')").text(),
            state: "",
            region: "",
            rawAddress: `${street} ${houseNumber} ${country}`,
        }
    }

    //street with housenumber or country is missing         
    while (object.address.rawAddress.startsWith(" ")) {
        object.address.rawAddress = object.address.rawAddress.replace(" ", "")
    }



    if (result.locationUrls.length > 0) {
        result.locationUrls.shift()
        object.description = $("#biobody").text()
        result.location = object
    }

    if (result.organizerUrls.length > 0) {

        if (request.loadedUrl === result.organizerUrls[0]) {
            result.organizerUrls.shift()
            delete object.description
            result.organizers.push(object)
        }

        if (result.organizerUrls.length > 0) {
            log.info(`enqueueing URL for organizer`);
            await enqueueLinks({
                userData: result,
                forefront: true,
                urls: [result.organizerUrls[0]],

                transformRequestFunction: (request) => {
                    request.uniqueKey = new Date().toISOString();
                    return request;
                }
            });
        }
    }

    if (result.organizerUrls.length === 0 && result.artistUrls.length > 0) {

        if (request.loadedUrl === result.artistUrls[0]) {
            result.artistUrls.shift()
            delete object.description
            result.artists.push(object)
        }
        if (result.artistUrls.length > 0) {
            log.info(`enqueueing URL for artist`);
            await enqueueLinks({
                userData: result,
                forefront: true,
                urls: [result.artistUrls[0]],
                transformRequestFunction: (request) => {
                    request.uniqueKey = new Date().toISOString();
                    return request;
                }
            });
        }
    }

    if (result.locationUrls.length === 0 && result.organizerUrls.length === 0 && result.artistUrls.length === 0) {

        delete result.organizerUrls
        delete result.artistUrls
        delete result.locationUrls
        delete result.label

        await Actor.pushData({
            ...result
        });
        console.log("Dataset pushed")
    }
});


export { cheerioRouter }



//TODOs
//??? - budou potreba cookies kvuli tomu jazyku (je to ted vazany na NL)?
//done - blocking ip adres => https://crawlee.dev/docs/guides/proxy-management
//done - kdyz radim ty requesty tak jim musim dat unique key pro artist/location/organizer nebo se mi nepridaj kdyz uz byly zpracovany pro jinou event 

// case: 
//"rawAddress": "Westersingel50a  Nederland"
//"street": "Westersingel50a",
//"houseNumber": "",

//mam tam davat || "" nebo to je v cheeriu zbytecny?

//dotazy na zakaznika
//jsou webovky jen webovky nebo i social sites?
// je jmeno u artists realny jmeno nebo jmeno umelecky? https://partyflock.nl/artist/99414:AIROD
// chtej do country p??vod nebo rezidenstvi? https://partyflock.nl/artist/558:Rush
//pokud nechtej zadny info z artists tak muzu scrapnout jen artist name v eventu a usetrit tim cas a costs