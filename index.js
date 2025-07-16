const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

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

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const DB = client.db("gamePlaneDB");
    const usersCollection = DB.collection("users");
    const courtsCollection = DB.collection("courts");
    const bookingsCollection = DB.collection("bookings");

    // users apis
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

    // courts apis
    app.get("/courts", async (req, res) => {
      const result = await courtsCollection.find().toArray();
      res.send(result);
    });

    // bookings apis
    // Get user's pending bookings
    app.get("/bookings/pending", async (req, res) => {
      const user = req.query.user;
      const query = { user, status: "pending" };
      const result = await bookingsCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      const result = await bookingsCollection.insertOne(booking);
      res.send(result);
    });

    // Cancel booking
    app.delete("/cancel-bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookingsCollection.deleteOne(query);
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
