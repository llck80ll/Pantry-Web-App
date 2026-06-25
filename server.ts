import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

// Increase request size limit to handle base64 image uploads
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ limit: "20mb", extended: true }));

let aiInstance: GoogleGenAI | null = null;

function getGemini(): GoogleGenAI {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not defined. Please add it to your Secrets.");
    }
    aiInstance = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiInstance;
}

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

import fs from "fs";
import { BASE_RECIPES } from "./src/recipesData";

const RECIPES_DB_PATH = path.join(process.cwd(), "src", "recipes_db.json");
const GEMINI_FORMULATION_TIMEOUT_MS = 8000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function getLocalRecipes() {
  try {
    if (fs.existsSync(RECIPES_DB_PATH)) {
      const data = fs.readFileSync(RECIPES_DB_PATH, "utf-8");
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("Failed to read recipes_db.json, using BASE_RECIPES memory fallback instead", err);
  }
  return BASE_RECIPES;
}

function saveLocalRecipe(newRecipe: any) {
  try {
    const list = getLocalRecipes();
    // Ensure unique ID
    const customId = `custom_${Date.now()}`;
    const recipeWithId = { ...newRecipe, id: customId };
    list.push(recipeWithId);
    fs.writeFileSync(RECIPES_DB_PATH, JSON.stringify(list, null, 2), "utf-8");
    return recipeWithId;
  } catch (err) {
    console.error("Failed to write to recipes_db.json", err);
    throw new Error("Local database write failed");
  }
}

function getPhotoHashForQuery(query: string): string {
  const norm = query.toLowerCase();
  if (norm.includes("pasta") || norm.includes("spaghetti") || norm.includes("italian")) {
    return "1612874742237-6526221588e3";
  }
  if (norm.includes("chicken") || norm.includes("meat")) {
    return "1532550907401-a500c9a57435";
  }
  if (norm.includes("beef") || norm.includes("steak") || norm.includes("asian") || norm.includes("stir")) {
    return "1512058564366-18510be2db19";
  }
  if (norm.includes("fish") || norm.includes("salmon") || norm.includes("seafood")) {
    return "1485921325833-c519f76c4927";
  }
  if (norm.includes("soup") || norm.includes("stew") || norm.includes("chili")) {
    return "1547592165-e1d17fed6005";
  }
  if (norm.includes("salad") || norm.includes("green") || norm.includes("healthy") || norm.includes("vegetable")) {
    return "1546069901-ba9599a7e63c";
  }
  if (norm.includes("egg") || norm.includes("breakfast") || norm.includes("brunch")) {
    return "1525351484163-7529414344d8";
  }
  if (norm.includes("dessert") || norm.includes("sweet") || norm.includes("cake") || norm.includes("cookie")) {
    return "1511018556340-d16986a1c194";
  }
  const fallbacks = [
    "1504674900247-0877df9cc836",
    "1565299624946-b28f40a0ae38",
    "1476224203421-9ac39bcb3327",
    "1498837167922-ddd27525d352",
    "1540189549336-e6e99c3679fe"
  ];
  const idx = Math.abs(query.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)) % fallbacks.length;
  return fallbacks[idx];
}

function saveFormulatedRecipesToDb(formulatedRecipes: any[]) {
  try {
    const list = getLocalRecipes();
    const added: any[] = [];
    for (const r of formulatedRecipes) {
      const exists = list.some((existing: any) => existing.name.toLowerCase() === r.name.toLowerCase());
      if (!exists) {
        const customId = `formulated_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
        const query = (r.tags && r.tags[0]) || r.name;
        const imageUrl = r.imageUrl || `https://images.unsplash.com/photo-${getPhotoHashForQuery(query)}?auto=format&fit=crop&w=600&q=80`;
        const rWithMeta = {
          ...r,
          id: customId,
          imageUrl
        };
        list.push(rWithMeta);
        added.push(rWithMeta);
      }
    }
    if (added.length > 0) {
      fs.writeFileSync(RECIPES_DB_PATH, JSON.stringify(list, null, 2), "utf-8");
      console.log(`Successfully formulated and stored ${added.length} new recipes in the database!`);
    } else {
      console.log("Formulated recipes already exist in the database; skipping duplicates.");
    }
  } catch (err) {
    console.error("Failed to save formulated recipes to recipes_db.json", err);
  }
}

// Get all database recipes
app.get("/api/recipes", (req, res) => {
  try {
    const recipes = getLocalRecipes();
    res.json(recipes);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to load database recipes." });
  }
});

// Create custom recipe in local database
app.post("/api/recipes", (req, res) => {
  try {
    const newRecipe = req.body;
    if (!newRecipe || !newRecipe.name || !newRecipe.allIngredients || !newRecipe.instructions) {
      return res.status(400).json({ error: "Missing required recipe parameters (name, ingredients, instructions)" });
    }
    const saved = saveLocalRecipe(newRecipe);
    res.status(201).json(saved);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to add to database." });
  }
});

// Helper function to scale ingredient amounts of the local recipes
function scaleAmount(amountStr: string, factor: number): string {
  const fractionMap: Record<string, number> = {
    "1/2": 0.5, "1/3": 0.33, "1/4": 0.25, "3/4": 0.75, "1/8": 0.125
  };

  let num = 0;
  let rest = amountStr;

  const fracRegex = /^(\d+\s+)?(\d+\/\d+)\s*(.*)$/;
  const decRegex = /^(\d*\.?\d+)\s*(.*)$/;

  const fracMatch = amountStr.match(fracRegex);
  if (fracMatch) {
    const whole = fracMatch[1] ? parseFloat(fracMatch[1].trim()) : 0;
    const fracStr = fracMatch[2];
    const fracVal = fractionMap[fracStr] || 0.5;
    num = whole + fracVal;
    rest = fracMatch[3];
  } else {
    const decMatch = amountStr.match(decRegex);
    if (decMatch) {
      num = parseFloat(decMatch[1]);
      rest = decMatch[2];
    }
  }

  if (num > 0 && !isNaN(num)) {
    const scaledNum = Math.round(num * factor * 100) / 100;
    let formattedNum = scaledNum.toString();
    if (scaledNum === 0.5) formattedNum = "1/2";
    else if (scaledNum === 0.25) formattedNum = "1/4";
    else if (scaledNum === 0.75) formattedNum = "3/4";
    else if (scaledNum === 1.5) formattedNum = "1 1/2";
    else if (scaledNum === 2.5) formattedNum = "2 1/2";
    
    return `${formattedNum} ${rest}`.trim();
  }

  return amountStr;
}

// Recipe Recommendation API (Offline Local Matching Engine)
app.post("/api/recipe/recommend", async (req, res) => {
  try {
    const { image, imageType, ingredients, cuisine, servings } = req.body;

    const pantryList: string[] = Array.isArray(ingredients) 
      ? ingredients 
      : (typeof ingredients === "string" ? ingredients.split(",").map(i => i.trim()).filter(Boolean) : []);

    const normalizedPantry = pantryList.map(item => item.toLowerCase().trim());

    // Dynamically formulate bespoke recipes via Gemini 3.5 Flash block and store them in the database
    if (pantryList.length > 0 && process.env.GEMINI_API_KEY) {
      try {
        console.log(`Formulating bespoke recipes with Gemini for ingredient combination: ${pantryList.join(", ")}`);
        const ai = getGemini();
        const prompt = `Formulate 2 to 3 creative, high-quality, delicious recipes that specifically utilize the combination of these ingredients: ${pantryList.join(", ")}.
Also suggest other standard pantry items (like seasonings, olive oil, salt, water, garlic, butter) as needed to round out each recipe.
Return the result in JSON format as a list of recipe objects. Ensure each recipe has realistic details, step-by-step instructions, and proper ingredient category allocations (Produce, Meat, Dairy, Grains, Fruits, Pantry, Dry Seasonings).`;

        const response = await withTimeout(
          ai.models.generateContent({
            model: "gemini-3.5-flash",
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING, description: "Short, appealing name for the dish" },
                    description: { type: Type.STRING, description: "A one-sentence mouthwatering description" },
                    prepTime: { type: Type.INTEGER, description: "Estimated prep time in minutes" },
                    cookTime: { type: Type.INTEGER, description: "Estimated cook time in minutes" },
                    servings: { type: Type.INTEGER, description: "Typically 2 or 4" },
                    difficulty: { type: Type.STRING, description: "'Easy' or 'Medium' or 'Hard'" },
                    tags: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Cuisine tags, e.g., Italian, Asian, Comfort Food, Vegetarian, etc." },
                    allIngredients: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          name: { type: Type.STRING },
                          amount: { type: Type.STRING, description: "Units like 200g, 1 tbsp, 2 whole, etc." },
                          category: { type: Type.STRING, description: "One of Grains, Meat, Dairy, Produce, Fruits, Pantry, Dry Seasonings" }
                        },
                        required: ["name", "amount", "category"]
                      }
                    },
                    instructions: { type: Type.ARRAY, items: { type: Type.STRING } },
                    nutritionalInfo: {
                      type: Type.OBJECT,
                      properties: {
                        calories: { type: Type.INTEGER },
                        protein: { type: Type.STRING },
                        carbs: { type: Type.STRING },
                        fat: { type: Type.STRING }
                      },
                      required: ["calories", "protein", "carbs", "fat"]
                    }
                  },
                  required: ["name", "description", "prepTime", "cookTime", "servings", "difficulty", "tags", "allIngredients", "instructions", "nutritionalInfo"]
                }
              }
            }
          }),
          GEMINI_FORMULATION_TIMEOUT_MS,
          "Gemini formulation"
        );

        if (response && response.text) {
          const formulated = JSON.parse(response.text.trim());
          if (Array.isArray(formulated) && formulated.length > 0) {
            saveFormulatedRecipesToDb(formulated);
          }
        }
      } catch (geminiError) {
        console.error("Gemini formulation execution failed, falling back to local database matches:", geminiError);
      }
    }

    const currentRecipes = getLocalRecipes();

    // Score and rank all baseline recipes
    const scoredRecipes = currentRecipes.map(base => {
      // Create copy of all ingredients with safe fallback
      const baseIngredients = base.allIngredients || [];
      const allIngredients = baseIngredients.map(ing => ({ ...ing }));
      const matchingIngredients: string[] = [];
      const additionalIngredientsNeeded: string[] = [];

      allIngredients.forEach(ing => {
        const ingNameNorm = ing.name.toLowerCase().trim();
        
        const hasMatch = normalizedPantry.some(pantryItem => {
          const itemSing = pantryItem.endsWith("s") && pantryItem.length > 3 ? pantryItem.slice(0, -1) : pantryItem;
          const ingSing = ingNameNorm.endsWith("s") && ingNameNorm.length > 3 ? ingNameNorm.slice(0, -1) : ingNameNorm;
          
          return ingNameNorm.includes(pantryItem) || 
                 pantryItem.includes(ingNameNorm) || 
                 ingSing.includes(itemSing) || 
                 itemSing.includes(ingSing);
        });

        if (hasMatch) {
          matchingIngredients.push(ing.name);
        } else {
          additionalIngredientsNeeded.push(ing.name);
        }
      });

      const totalIng = allIngredients.length;
      const matches = matchingIngredients.length;
      const matchScore = totalIng > 0 ? matches / totalIng : 0;

      // Filter/Prioritize custom cuisine choice
      let cuisineMatch = false;
      if (cuisine && cuisine !== "All" && cuisine !== "Any" && cuisine.trim() !== "") {
        const cuisineNorm = cuisine.toLowerCase().trim();
        cuisineMatch = base.tags.some(tag => tag.toLowerCase() === cuisineNorm);
      } else {
        cuisineMatch = true;
      }

      return {
        recipe: {
          ...base,
          allIngredients,
          matchingIngredients,
          additionalIngredientsNeeded,
          detectedIngredients: []
        },
        matchScore,
        matches,
        cuisineMatch
      };
    });

    // Sort by cuisine match first, then by matchScore percentage descending, then absolute match count, then fewer missing ingredients
    const sortedRecipes = scoredRecipes.sort((a, b) => {
      if (a.cuisineMatch && !b.cuisineMatch) return -1;
      if (!a.cuisineMatch && b.cuisineMatch) return 1;

      if (b.matchScore !== a.matchScore) {
        return b.matchScore - a.matchScore;
      }
      if (b.matches !== a.matches) {
        return b.matches - a.matches;
      }
      return a.recipe.additionalIngredientsNeeded.length - b.recipe.additionalIngredientsNeeded.length;
    });

    // Return more suggestions so the user can click "Show More" / pagination
    const selected = sortedRecipes.slice(0, 30).map(item => item.recipe);

    // Apply portion scaling factors dynamically if servings is specified
    const servingsCount = typeof servings === "number" && servings > 0 ? servings : 2;

    const scaledSelected = selected.map(recipe => {
      const defaultServings = recipe.servings;
      if (servingsCount === defaultServings) {
        return recipe;
      }

      const factor = servingsCount / defaultServings;

      const recipeIngredients = recipe.allIngredients || [];
      const scaledIngredients = recipeIngredients.map(ing => ({
        ...ing,
        amount: scaleAmount(ing.amount, factor)
      }));

      const baseNut = recipe.nutritionalInfo;
      const scaledNut = {
        calories: Math.round(baseNut.calories * factor),
        protein: scaleAmount(baseNut.protein, factor),
        carbs: scaleAmount(baseNut.carbs, factor),
        fat: scaleAmount(baseNut.fat, factor)
      };

      return {
        ...recipe,
        servings: servingsCount,
        allIngredients: scaledIngredients,
        nutritionalInfo: scaledNut
      };
    });

    res.json({
      recipes: scaledSelected,
      detectedIngredients: []
    });
  } catch (error: any) {
    console.error("Local Recipe Recommendation Error:", error);
    res.status(500).json({
      error: error.message || "An unexpected error occurred while recommending recipes locally.",
    });
  }
});

// Setup Vite Dev Server / Static Asset Serving
async function mountAssets() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite development server middleware mounted.");
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("Serving static assets from:", distPath);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Pantry server listening on http://localhost:${PORT}`);
  });
}

mountAssets().catch((err) => {
  console.error("Failed to start full-stack server:", err);
});
