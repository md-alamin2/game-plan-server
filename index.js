const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const serviceToken = process.env.FIREBASE_SERVICE_TOKEN;
const decoded = Buffer.from(serviceToken, "base64").toString("utf8");
const serviceAccount = JSON.parse(decoded);
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGO_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// firebase middleware
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const DB = client.db("gamePlaneDB");
    const usersCollection = DB.collection("users");
    const courtsCollection = DB.collection("courts");
    const bookingsCollection = DB.collection("bookings");
    const announcementsCollection = DB.collection("announcements");

    // custom middleware
    // verify token
    const verifyFirebaseToken = async (req, res, next) => {
      const authHeader = req.headers?.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).send({ message: "unauthorized access" });
      }

      const token = authHeader.split(" ")[1];
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      } catch {
        return res.status(401).send({ message: "unauthorized access" });
      }
    };
    // verify email
    const verifyFirebaseEmail = (req, res, next) => {
      if (req.query.email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // admin verify
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const user = await usersCollection.findOne(query);

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // users apis
    app.get("/users", async (req, res) => {
      const user = req.query.search;
      const role = req.query.role;
      let query = {};
      if (user) {
        query = {
          name: { $regex: user, $options: "i" },
        };
      }

      if (role === "member") {
        query={role};
      } else if(role === "admin") {
        query={role};
      }
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

    // get user role by email
    app.get("/users/role", async (req, res) => {
      const email = req.query.email;
      const query = { email };
      const result = await usersCollection.findOne(query);
      res.send(result);
    });

    // post user data
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);

      if (existingUser) {
        // update last login
        const lastLogin = req.body.last_login;
        const updateLastLogin = await usersCollection.updateOne(query, {
          $set: { last_login: lastLogin },
        });
        return res.status(200).send(updateLastLogin, {
          message: "user already exists",
          inserted: "false",
        });
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.patch("/users", async (req, res) => {
      const user = req.body;
      const email = req.query.email;
      const query = { email };
      const updateUser = await usersCollection.updateOne(query, {
        $set: user,
      });
      res.send(updateUser);
    });

    // members api

    // get members
    app.get("/members", async (req, res) => {
      const user = req.query.search;
      let query = { role: "member" };
      if (user) {
        query = {
          $or: [{ name: { $regex: user, $options: "i" } }],
          role: "member",
        };
      }
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

    // DELETE user by email (admin only)
    app.delete(
      "/members",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.query.email;

        if (!email) {
          return res
            .status(400)
            .json({ message: "Email is required in query" });
        }

        const userRecord = await admin.auth().getUserByEmail(email);
        const uid = userRecord.uid;

        await admin.auth().deleteUser(uid);

        const result = await usersCollection.deleteOne({ email });

        res.send(result);
      }
    );

    // courts apis
    app.get("/courts", async (req, res) => {
      const result = await courtsCollection.find().toArray();
      res.send(result);
    });

    // bookings apis
    // Get user's pending bookings
    app.get("/bookings/pending", async (req, res) => {
      const user = req.query.user;
      const role = req.query.role;
      if (role === "admin") {
        const result = await bookingsCollection
          .find({ status: "pending" })
          .toArray();
        return res.send(result);
      }
      const query = { user, status: { $in: ["pending", "rejected"] } };
      const result = await bookingsCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      const result = await bookingsCollection.insertOne(booking);
      res.send(result);
    });

    app.patch("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const status = req.body.status;
      const user = req.body.user;
      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          status: status,
        },
      };

      if (status === "approved") {
        await usersCollection.updateOne(
          { email: user },
          { $set: { role: "member", member_since: new Date().toISOString() } }
        );
      }
      const result = await bookingsCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    // Cancel booking
    app.delete("/cancel-bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookingsCollection.deleteOne(query);
      res.send(result);
    });

    // announcement apis

    app.get("/announcements", async (req, res) => {
      const result = await announcementsCollection.find().toArray();
      res.send(result);
    });

    // announcement search api
    app.get("/announcements/search", async (req, res) => {
      try {
        const { title } = req.query;
        const announcements = await announcementsCollection
          .find({
            title: { $regex: title, $options: "i" }, // Case-insensitive search
          })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(announcements);
      } catch (err) {
        res.status(500).json({ message: "Server error" });
      }
    });

    // announcement post api
    app.post("/announcements", async (req, res) => {
      const announcement = req.body;
      const newAnnouncement = {
        ...announcement,
        created_at: new Date().toISOString(),
      };
      const result = await announcementsCollection.insertOne(newAnnouncement);
      res.send(result);
    });

    // announcement post api
    app.patch("/announcements/:id", async (req, res) => {
      const id = req.params.id;
      const updatedAnnouncement = req.body;
      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          title: updatedAnnouncement.title,
          description: updatedAnnouncement.description,
        },
      };
      const result = await announcementsCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    // announcement delete api
    app.delete("/announcements/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await announcementsCollection.deleteOne(query);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Game Server is running");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
