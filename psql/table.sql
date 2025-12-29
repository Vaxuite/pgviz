CREATE TABLE test_table (
    name VARCHAR(255),
    age INTEGER,
    amount INTEGER
);

-- Insert 1 million rows with random names, ages, and amounts
INSERT INTO test_table (name, age, amount)
SELECT 
    -- Generate random name using md5 hash (first 8 characters, uppercase first letter)
    UPPER(LEFT(md5(random()::text), 1)) || LOWER(SUBSTRING(md5(random()::text), 2, 7)) AS name,
    -- Generate random age between 18 and 100
    18 + floor(random() * 83)::int AS age,
    -- Generate random amount between 100 and 10000
    100 + floor(random() * 9901)::int AS amount
FROM generate_series(1, 1000000);

-- Create index on name and age for better performance
CREATE INDEX idx_test_table_name_age ON test_table (name, age DESC);

-- Query to find amount for the highest age entry for each provided name using LATERAL JOIN
EXPLAIN (ANALYZE, COSTS, VERBOSE, BUFFERS, FORMAT JSON) SELECT 
    n.name,
    t.age,
    t.amount
FROM 
    (VALUES ('John'), ('Jane'), ('Jill')) AS n(name)
INNER JOIN LATERAL (
    SELECT age, amount
    FROM test_table
    WHERE name = n.name
    ORDER BY age DESC
    LIMIT 1
) AS t ON true;
