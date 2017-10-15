import request = require("request");
import express = require("express");
import bodyParser = require("body-parser");
import mustacheExpress = require("mustache-express");
import session = require("express-session");
import dbSession = require('connect-mongodb-session');

import { Library, StatBlock, Spell } from "./library";
import { configureLoginRedirect, startNewsUpdates } from "./patreon";
import * as DB from "./dbconnection";

const appInsightsKey = process.env.APPINSIGHTS_INSTRUMENTATIONKEY || "";
const baseUrl = process.env.BASE_URL || "";
const patreonClientId = process.env.PATREON_CLIENT_ID || "PATREON_CLIENT_ID";
const defaultAccountLevel = process.env.DEFAULT_ACCOUNT_LEVEL || "free";

type Req = Express.Request & express.Request;
type Res = Express.Response & express.Response;

const pageRenderOptions = (encounterId: string, session: Express.Session) => ({
    rootDirectory: "../../",
    encounterId,
    appInsightsKey,
    baseUrl,
    patreonClientId,
    isLoggedIn: session.isLoggedIn || false,
    hasStorage: session.hasStorage || false,
    postedEncounter: null,
});

const probablyUniqueString = (): string => {
    const chars = "1234567890abcdefghijkmnpqrstuvxyz";
    let str = "";
    for (let i = 0; i < 8; i++) {
        const index = Math.floor(Math.random() * chars.length);
        str += chars[index];
    }

    return str;
};

const initializeNewPlayerView = (playerViews) => {
    const encounterId = probablyUniqueString();
    playerViews[encounterId] = {};
    return encounterId;
};

const verifyStorage = (req: Req) => {
    return req.session && req.session.hasStorage;
}

export default function (app: express.Application, statBlockLibrary: Library<StatBlock>, spellLibrary: Library<Spell>, playerViews) {
    const mustacheEngine = mustacheExpress();
    const MongoDBStore = dbSession(session);
    
    if (process.env.DB_CONNECTION_STRING) {
        var store = new MongoDBStore(
        {
            uri: process.env.DB_CONNECTION_STRING,
            collection: 'sessions'
        });
    }
    
    if (process.env.NODE_ENV === "development") {
        mustacheEngine.cache._max = 0;
    }
    app.engine("html", mustacheEngine);
    app.set("view engine", "html");
    app.set("views", __dirname + "/../html");

    app.use(express.static(__dirname + "/../public"));
    app.use(session({
        store: store || null,
        secret: process.env.SESSION_SECRET || probablyUniqueString(),
        resave: false,
        saveUninitialized: false,
    }));
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: false }));
    
    app.get("/", (req: Req, res: Res) => {
        if (defaultAccountLevel === "accountsync") {
            req.session.hasStorage = true;
            DB.upsertUser("defaultPatreonId", "accesskey", "refreshkey", "pledge")
                .then(result => {
                    req.session.userId = result._id;
                    res.render("landing", pageRenderOptions(initializeNewPlayerView(playerViews), req.session));
                });
        } else {
            res.render("landing", pageRenderOptions(initializeNewPlayerView(playerViews), req.session));
        }
    });

    app.get("/e/:id", (req: Req, res: Res) => {
        const session: any = req.session;
        const options = pageRenderOptions(req.params.id, req.session);
        if (session.postedEncounter) {
            options.postedEncounter = JSON.stringify(session.postedEncounter);
        }
        res.render("tracker", options);
    });

    app.get("/p/:id", (req: Req, res: Res) => {
        res.render("playerview", pageRenderOptions(req.params.id, req.session));
    });

    app.get("/playerviews/:id", (req: Req, res: Res) => {
        res.json(playerViews[req.params.id]);
    });

    app.get("/templates/:name", (req: Req, res: Res) => {
        res.render(`templates/${req.params.name}`, pageRenderOptions("", req.session));
    });

    app.get(statBlockLibrary.Route(), (req: Req, res: Res) => {
        res.json(statBlockLibrary.GetListings());
    });

    app.get(statBlockLibrary.Route() + ":id", (req: Req, res: Res) => {
        res.json(statBlockLibrary.GetById(req.params.id));
    });

    app.get(spellLibrary.Route(), (req: Req, res: Res) => {
        res.json(spellLibrary.GetListings());
    });

    app.get(spellLibrary.Route() + ":id", (req: Req, res: Res) => {
        res.json(spellLibrary.GetById(req.params.id));
    });

    app.get("/my", (req: Req, res: Res) => {
        if (!verifyStorage(req)) {
            return res.sendStatus(403);
        }

        return DB.getAccount(req.session.userId, account => {
            return res.json(account);
        }).catch(err => {
            return res.sendStatus(500);
        });
    })

    app.post("/my/settings", (req, res: express.Response) => {
        if (!verifyStorage(req)) {
            return res.sendStatus(403);
        }
        
        const newSettings = req.body;

        if (newSettings.Version) {
            return DB.setSettings(req.session.userId, newSettings).then(r => {
                return res.sendStatus(200);
            });
        } else {
            return res.status(400).send("Invalid settings object, requires Version number.");
        }
    });

    app.get("/my/statblocks/:id", (req: Req, res: Res) => {
        if (!verifyStorage(req)) {
            return res.sendStatus(403);
        }

        return DB.getEntity<StatBlock>("statblocks", req.session.userId, req.params.id, statBlock => {
            if (statBlock) {
                return res.json(statBlock);    
            } else {
                return res.sendStatus(404);
            }
            
        }).catch(err => {
            return res.sendStatus(500);
        });
    });

    app.post("/my/statblocks/", (req, res: Res) => {
        if (!verifyStorage(req)) {
            return res.sendStatus(403);
        }

        return DB.saveEntity("statblocks", req.session.userId, req.body, result => {
            return res.sendStatus(201);    
        }).catch(err => {
            return res.status(500).send(err);
        });
    });

    const importEncounter = (req, res: Res) => {
        const newViewId = initializeNewPlayerView(playerViews);
        const session = req.session;

        if (typeof req.body.Combatants === "string") {
            session.postedEncounter = { Combatants: JSON.parse(req.body.Combatants) };
        } else {
            session.postedEncounter = req.body;
        }

        res.redirect("/e/" + newViewId);
    };

    app.post("/launchencounter/", importEncounter);
    app.post("/importencounter/", importEncounter);

    configureLoginRedirect(app);
    startNewsUpdates(app);
}
